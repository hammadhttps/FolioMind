import { EVENT_NAMES, type NotificationType } from "@foliomind/contracts";
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
import { and, eq, inArray, sql } from "drizzle-orm";
import { effectivePlanCode } from "../entitlements";
import type {
  BillingGateway,
  CheckoutSessionRecord,
  StripeInvoiceRecord,
  StripeSubscriptionRecord,
} from "./gateway";

/*
 * Synchronizing billing state (blueprint Section 10 "Webhook endpoint and
 * durability"). A webhook only says *that* something changed: the sync fetches
 * the customer's current subscriptions and invoices from Stripe and rebuilds
 * the local snapshot from them, so events arriving late, twice or out of order
 * can't overwrite newer state. Entitlement is derived from that snapshot
 * (paid-through times from paid invoices), so nothing is granted twice.
 */

/** Statuses after which a subscription no longer counts toward "one live subscription". */
const TERMINAL = new Set(["canceled", "incomplete_expired"]);

export interface BillingNotice {
  userId: string;
  type: NotificationType;
  subjectId: string;
  operationKey: string;
}

export interface CustomerSyncResult {
  userId: string | null;
  /** The effective plan changed: drop the user's cached snapshot and usage summary. */
  planChanged: boolean;
  planCode: "free" | "pro";
  /** Duplicate live subscriptions cancelled so the customer is never billed twice. */
  cancelledDuplicates: string[];
}

/** The user a Stripe customer belongs to, linking it from metadata if it isn't mapped yet. */
async function userForCustomer(
  db: Executor,
  customerId: string,
  metadataUserId: string | null,
): Promise<string | null> {
  const [mapped] = await db
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, customerId));
  if (mapped) return mapped.userId;
  if (!metadataUserId || !/^[0-9a-f-]{36}$/i.test(metadataUserId)) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, metadataUserId));
  if (!user) return null;
  // Only when the user has no customer yet: one customer per user, never re-pointed.
  await db
    .insert(billingCustomers)
    .values({ userId: user.id, stripeCustomerId: customerId })
    .onConflictDoNothing();
  const [linked] = await db
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, customerId));
  return linked?.userId ?? null;
}

/** End of the latest period covered by a paid invoice of this subscription. */
export function paidThroughFrom(
  subscriptionId: string,
  invoices: readonly StripeInvoiceRecord[],
): Date | null {
  let latest: Date | null = null;
  for (const invoice of invoices) {
    if (invoice.subscriptionId !== subscriptionId || invoice.status !== "paid") continue;
    if (!latest || invoice.periodEnd > latest) latest = invoice.periodEnd;
  }
  return latest;
}

/**
 * Brings the local snapshot in line with Stripe for one customer. Runs inside
 * sync-stripe (one customer at a time, by its concurrency key) and the hourly
 * reconciliation.
 */
export async function syncCustomer(
  db: Database,
  gateway: BillingGateway,
  input: { customerId: string; proPriceId: string; now?: Date },
): Promise<CustomerSyncResult> {
  const now = input.now ?? new Date();
  const remote = await gateway.listSubscriptions(input.customerId);
  const metadataUser = remote.find((subscription) => subscription.userId)?.userId ?? null;
  const userId = await userForCustomer(db, input.customerId, metadataUser);
  if (!userId) {
    return { userId: null, planChanged: false, planCode: "free", cancelledDuplicates: [] };
  }

  // Never two live subscriptions: keep the oldest, cancel any later duplicate.
  const live = remote
    .filter((subscription) => !TERMINAL.has(subscription.status))
    .sort((a, b) => a.created.getTime() - b.created.getTime());
  const cancelledDuplicates: string[] = [];
  for (const duplicate of live.slice(1)) {
    await gateway.cancelSubscription(duplicate.id);
    duplicate.status = "canceled";
    cancelledDuplicates.push(duplicate.id);
  }

  const invoices = new Map<string, StripeInvoiceRecord[]>();
  for (const subscription of remote) {
    invoices.set(subscription.id, await gateway.listInvoices(subscription.id));
  }

  const before = await effectivePlanCode(db, userId, now);
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    // Terminal rows first, so the "one nonterminal subscription" index never trips mid-sync.
    const ordered = [...remote].sort(
      (a, b) => Number(!TERMINAL.has(a.status)) - Number(!TERMINAL.has(b.status)),
    );
    for (const subscription of ordered) {
      await upsertSubscription(tx, userId, subscription, input.proPriceId, invoices, now);
    }
  });
  const after = await effectivePlanCode(db, userId, now);
  return { userId, planChanged: before !== after, planCode: after, cancelledDuplicates };
}

async function upsertSubscription(
  tx: Executor,
  userId: string,
  subscription: StripeSubscriptionRecord,
  proPriceId: string,
  invoicesBySubscription: Map<string, StripeInvoiceRecord[]>,
  now: Date,
) {
  const invoices = invoicesBySubscription.get(subscription.id) ?? [];
  // Only the allowlisted price grants Pro; anything else is recorded as Free.
  const planCode = subscription.priceIds.includes(proPriceId) ? "pro" : "free";
  const values = {
    userId,
    stripeSubscriptionId: subscription.id,
    planCode,
    status: subscription.status,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    paidThrough: paidThroughFrom(subscription.id, invoices),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    syncedAt: now,
  };
  const [row] = await tx
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        planCode: values.planCode,
        status: values.status,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        paidThrough: values.paidThrough,
        cancelAtPeriodEnd: values.cancelAtPeriodEnd,
        syncedAt: values.syncedAt,
        updatedAt: sql`now()`,
      },
      // A subscription never moves to another user.
      setWhere: eq(subscriptions.userId, userId),
    })
    .returning({ id: subscriptions.id });
  if (!row) return;
  for (const invoice of invoices) {
    await tx
      .insert(billingInvoices)
      .values({
        stripeInvoiceId: invoice.id,
        subscriptionId: row.id,
        status: invoice.status,
        amountPaid: invoice.amountPaid,
        currency: invoice.currency,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      })
      .onConflictDoUpdate({
        target: billingInvoices.stripeInvoiceId,
        set: {
          status: invoice.status,
          amountPaid: invoice.amountPaid,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Records what a Checkout session became (open, complete, expired or failed). */
export async function syncCheckoutSession(
  db: Executor,
  session: CheckoutSessionRecord,
  options: { asyncPaymentFailed?: boolean } = {},
): Promise<void> {
  const status = options.asyncPaymentFailed
    ? "failed"
    : session.status === "complete"
      ? "complete"
      : session.status === "expired"
        ? "expired"
        : "open";
  // Attempts only move forward: open → complete or expired, and complete → failed
  // when a delayed payment fails afterwards. Nothing reopens.
  if (status === "open") return;
  await db
    .update(billingCheckoutAttempts)
    .set({ status, updatedAt: sql`now()` })
    .where(
      and(
        eq(billingCheckoutAttempts.stripeSessionId, session.id),
        inArray(
          billingCheckoutAttempts.status,
          status === "failed" ? ["open", "complete"] : ["open"],
        ),
      ),
    );
}

/**
 * Notices an event asks for (Section 10: notify on failed payments and
 * required authentication), keyed by the Stripe object so a repeat sends none.
 */
export async function noticesForEvent(
  db: Executor,
  input: { userId: string; eventType: string; objectId: string | null },
): Promise<BillingNotice[]> {
  const type: NotificationType | null =
    input.eventType === "invoice.payment_failed" ||
    input.eventType === "checkout.session.async_payment_failed"
      ? "payment_failed"
      : input.eventType === "invoice.payment_action_required"
        ? "payment_action_required"
        : null;
  if (!type || !input.objectId) return [];
  const [subscription] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, input.userId))
    .orderBy(sql`${subscriptions.periodEnd} desc`)
    .limit(1);
  if (!subscription) return [];
  return [
    {
      userId: input.userId,
      type,
      subjectId: subscription.id,
      operationKey: `billing-${type}:${input.objectId}`,
    },
  ];
}

export async function markWebhookEvent(
  db: Executor,
  eventId: string,
  outcome: { status: "processed" | "failed" | "ignored"; errorCode?: string | null },
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      status: outcome.status,
      processedAt: outcome.status === "failed" ? null : sql`now()`,
      attempts: sql`${webhookEvents.attempts} + 1`,
      errorCode: outcome.errorCode ?? null,
    })
    .where(eq(webhookEvents.providerEventId, eventId));
}

export async function isWebhookEventProcessed(db: Executor, eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: webhookEvents.status })
    .from(webhookEvents)
    .where(eq(webhookEvents.providerEventId, eventId));
  return row?.status === "processed" || row?.status === "ignored";
}

/**
 * Customers whose snapshot may be stale (Section 10: reconciliation covers
 * missed events): live subscriptions not synced for six hours or past their
 * period end, open checkout attempts older than an hour, and webhook events
 * that didn't finish.
 */
export async function customersToReconcile(
  db: Executor,
  { limit = 20, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<string[]> {
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const quarterAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  const rows = await db.execute<{ customer: string }>(sql`
    select distinct c.stripe_customer_id as customer from billing_customers c
    where exists (
        select 1 from subscriptions s where s.user_id = c.user_id
          and s.status not in ('canceled', 'incomplete_expired')
          and (s.synced_at < ${sixHoursAgo}::timestamptz or s.period_end < ${nowIso}::timestamptz))
      or exists (
        select 1 from billing_checkout_attempts a where a.user_id = c.user_id
          and a.status = 'open' and a.created_at < ${hourAgo}::timestamptz)
      or exists (
        select 1 from webhook_events w where w.payload->>'customerId' = c.stripe_customer_id
          and w.status in ('received', 'failed') and w.received_at < ${quarterAgo}::timestamptz)
    limit ${limit}`);
  return rows.map((row) => row.customer);
}

/** Open checkout sessions older than an hour, to settle during reconciliation. */
export async function staleCheckoutSessions(
  db: Executor,
  { limit = 20, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<string[]> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const rows = await db
    .select({ sessionId: billingCheckoutAttempts.stripeSessionId })
    .from(billingCheckoutAttempts)
    .where(
      and(
        eq(billingCheckoutAttempts.status, "open"),
        sql`${billingCheckoutAttempts.createdAt} < ${hourAgo.toISOString()}::timestamptz`,
      ),
    )
    .limit(limit);
  return rows.flatMap((row) => (row.sessionId ? [row.sessionId] : []));
}

/** The notification events to send for billing notices (through send-notification). */
export function noticeEvents(notices: readonly BillingNotice[]) {
  return notices.map((notice) => ({
    id: notice.operationKey,
    name: EVENT_NAMES.notificationCreated,
    data: {
      userId: notice.userId,
      type: notice.type,
      subjectId: notice.subjectId,
      operationKey: notice.operationKey,
    },
  }));
}

/** Webhook payloads are minimized on arrival; old rows are removed (Section 12). */
export async function purgeOldWebhookEvents(
  db: Executor,
  { olderThanDays = 30 }: { olderThanDays?: number } = {},
): Promise<number> {
  const before = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const removed = await db.execute<{ id: string }>(sql`
    delete from webhook_events
    where status in ('processed', 'ignored') and received_at < ${before}::timestamptz
    returning provider_event_id as id`);
  return removed.length;
}

/** After a full re-sync, the customer's unfinished events are settled. */
export async function markCustomerEventsProcessed(db: Executor, customerId: string): Promise<void> {
  await db.execute(sql`
    update webhook_events set status = 'processed', processed_at = now()
    where payload->>'customerId' = ${customerId} and status in ('received', 'failed')`);
}
