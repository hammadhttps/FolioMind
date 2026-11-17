import { randomUUID } from "node:crypto";
import {
  EVENT_NAMES,
  type BillingRefusalCode,
  type BillingSnapshot,
  type StripeWebhookEvent,
} from "@foliomind/contracts";
import {
  billingCheckoutAttempts,
  billingCustomers,
  billingInvoices,
  subscriptions,
  users,
  webhookEvents,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, desc, eq, gt, notInArray, sql } from "drizzle-orm";
import { effectivePlanCode } from "../entitlements";
import { enqueue } from "../outbox";
import type { BillingGateway } from "./gateway";

/*
 * Checkout, Portal and webhook acceptance (blueprint Section 10 "Checkout
 * flow" and "Webhook endpoint and durability"). Subscription starts are
 * serialized per user under a row lock, so concurrent requests reuse one open
 * Checkout session instead of creating a second subscription. Webhooks are
 * accepted only after the event row and its outbox event commit together.
 */

export type CheckoutOutcome =
  { ok: true; url: string; reused: boolean } | { ok: false; code: BillingRefusalCode };

/** The user's Stripe customer, created once and mapped uniquely (Section 10 step 2). */
export async function ensureCustomer(
  db: Database,
  gateway: BillingGateway,
  user: { id: string; email: string },
): Promise<string> {
  const [existing] = await db
    .select({ customerId: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, user.id));
  if (existing) return existing.customerId;
  const customerId = await gateway.createCustomer({ userId: user.id, email: user.email });
  await db
    .insert(billingCustomers)
    .values({ userId: user.id, stripeCustomerId: customerId })
    .onConflictDoNothing();
  const [mapped] = await db
    .select({ customerId: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, user.id));
  if (!mapped) throw new Error("Billing customer mapping is missing");
  return mapped.customerId;
}

/**
 * `POST /api/billing/checkout` (Section 10 steps 1–4): the price comes from the
 * server's allowlist, the user must be active with a verified email and not
 * already Pro, and the session carries the user's ID in its metadata.
 */
export async function startCheckout(
  db: Database,
  gateway: BillingGateway,
  input: {
    userId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    now?: Date;
  },
): Promise<CheckoutOutcome> {
  const now = input.now ?? new Date();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, input.userId));
  if (!user || user.status !== "active" || user.deletedAt) {
    return { ok: false, code: "account_inactive" };
  }
  // Section 22 rule 2: an unverified address can't buy Pro.
  if (!user.emailVerified) return { ok: false, code: "email_unverified" };
  if ((await effectivePlanCode(db, user.id, now)) === "pro")
    return { ok: false, code: "already_pro" };

  const customerId = await ensureCustomer(db, gateway, user);
  return db.transaction(async (tx) => {
    // Serializes subscription starts for this user (Section 10 step 2).
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    if ((await effectivePlanCode(tx, user.id, now)) === "pro") {
      return { ok: false, code: "already_pro" } as const;
    }
    // A subscription waiting on its first payment must be finished, not duplicated.
    const [waiting] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, user.id),
          notInArray(subscriptions.status, ["canceled", "incomplete_expired"]),
        ),
      );
    if (waiting) return { ok: false, code: "payment_pending" } as const;

    // Reuse a session that's still open rather than starting a second one.
    const [open] = await tx
      .select({
        id: billingCheckoutAttempts.id,
        sessionId: billingCheckoutAttempts.stripeSessionId,
      })
      .from(billingCheckoutAttempts)
      .where(
        and(
          eq(billingCheckoutAttempts.userId, user.id),
          eq(billingCheckoutAttempts.status, "open"),
          gt(billingCheckoutAttempts.expiresAt, new Date(now.getTime() + 60_000)),
        ),
      )
      .orderBy(desc(billingCheckoutAttempts.createdAt))
      .limit(1);
    if (open?.sessionId) {
      const session = await gateway.retrieveCheckoutSession(open.sessionId);
      if (session.status === "open" && session.url) {
        return { ok: true, url: session.url, reused: true } as const;
      }
      await tx
        .update(billingCheckoutAttempts)
        .set({
          status: session.status === "complete" ? "complete" : "expired",
          updatedAt: sql`now()`,
        })
        .where(eq(billingCheckoutAttempts.id, open.id));
      if (session.status === "complete") return { ok: false, code: "payment_pending" } as const;
    }

    const attemptId = randomUUID();
    const idempotencyKey = `checkout:${user.id}:${attemptId}`;
    const session = await gateway.createCheckoutSession({
      customerId,
      priceId: input.priceId,
      userId: user.id,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      idempotencyKey,
    });
    if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
    await tx.insert(billingCheckoutAttempts).values({
      id: attemptId,
      userId: user.id,
      stripeSessionId: session.id,
      idempotencyKey,
      status: "open",
      expiresAt: session.expiresAt,
    });
    return { ok: true, url: session.url, reused: false } as const;
  });
}

/** `POST /api/billing/portal` (Section 10 step 5): only the user's own stored customer. */
export async function openPortal(
  db: Executor,
  gateway: BillingGateway,
  input: { userId: string; returnUrl: string },
): Promise<{ ok: true; url: string } | { ok: false; code: "no_customer" }> {
  const [customer] = await db
    .select({ customerId: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, input.userId));
  if (!customer) return { ok: false, code: "no_customer" };
  const session = await gateway.createPortalSession({
    customerId: customer.customerId,
    returnUrl: input.returnUrl,
  });
  return { ok: true, url: session.url };
}

export interface VerifiedStripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  objectId: string | null;
  customerId: string | null;
}

export const stripeEventOperationKey = (eventId: string) => `stripe-event:${eventId}`;

/**
 * Durable acceptance of a verified webhook (Section 10): the event row and its
 * outbox event commit together. A repeat delivery records nothing new. Only
 * IDs are kept, never the event body (Section 12: minimize payloads).
 */
export async function recordStripeEvent(
  db: Database,
  event: VerifiedStripeEvent,
): Promise<{ recorded: boolean; eventKey: string | null }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({
        providerEventId: event.id,
        type: event.type,
        objectId: event.objectId,
        payload: {
          created: event.created,
          livemode: event.livemode,
          customerId: event.customerId,
        },
        status: "received",
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.providerEventId });
    if (inserted.length === 0) return { recorded: false, eventKey: null };
    const operationKey = stripeEventOperationKey(event.id);
    await enqueue(tx, {
      key: operationKey,
      name: EVENT_NAMES.billingStripeWebhookRecorded,
      data: {
        eventId: event.id,
        eventType: event.type,
        objectId: event.objectId,
        customerId: event.customerId,
        operationKey,
      },
    });
    return { recorded: true, eventKey: operationKey };
  });
}

/** Whether FolioMind acts on this event type (anything else is acknowledged and ignored). */
export function isHandledStripeEvent(
  type: string,
  handled: readonly string[],
): type is StripeWebhookEvent {
  return handled.includes(type);
}

/** Billing and Usage's account view (also polled while a payment is pending). */
export async function billingSnapshot(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<BillingSnapshot> {
  const planCode = await effectivePlanCode(db, userId, now);
  const [latest] = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      paidThrough: subscriptions.paidThrough,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        notInArray(subscriptions.status, ["incomplete_expired"]),
      ),
    )
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [attempt] = await db
    .select({ status: billingCheckoutAttempts.status })
    .from(billingCheckoutAttempts)
    .where(
      and(
        eq(billingCheckoutAttempts.userId, userId),
        gt(billingCheckoutAttempts.createdAt, dayAgo),
      ),
    )
    .orderBy(desc(billingCheckoutAttempts.createdAt))
    .limit(1);
  const [customer] = await db
    .select({ id: billingCustomers.stripeCustomerId })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId));
  const invoices = await db
    .select({
      id: billingInvoices.stripeInvoiceId,
      status: billingInvoices.status,
      amountPaid: billingInvoices.amountPaid,
      currency: billingInvoices.currency,
      periodStart: billingInvoices.periodStart,
      periodEnd: billingInvoices.periodEnd,
      hostedInvoiceUrl: billingInvoices.hostedInvoiceUrl,
    })
    .from(billingInvoices)
    .innerJoin(subscriptions, eq(subscriptions.id, billingInvoices.subscriptionId))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(billingInvoices.periodStart))
    .limit(12);

  const status = latest?.status ?? null;
  return {
    planCode,
    subscription: latest
      ? {
          status: latest.status,
          cancelAtPeriodEnd: latest.cancelAtPeriodEnd,
          periodStart: latest.periodStart.toISOString(),
          periodEnd: latest.periodEnd.toISOString(),
          paidThrough: latest.paidThrough?.toISOString() ?? null,
        }
      : null,
    // Finished on Stripe's page but not yet confirmed by the webhook sync. (Billing
    // also shows Payment pending right after the success redirect, before that.)
    pendingCheckout:
      planCode === "free" &&
      attempt?.status === "complete" &&
      (status === null || status === "incomplete"),
    paymentIssue:
      status === "past_due" || status === "unpaid"
        ? "payment_failed"
        : status === "incomplete"
          ? "action_required"
          : null,
    hasCustomer: Boolean(customer),
    invoices: invoices.map((invoice) => ({
      ...invoice,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
    })),
  };
}
