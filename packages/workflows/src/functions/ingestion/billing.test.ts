import { randomUUID } from "node:crypto";
import { EVENT_NAMES } from "@foliomind/contracts";
import { billingCheckoutAttempts, webhookEvents, type Database } from "@foliomind/db";
import {
  cacheKeys,
  effectivePlanCode,
  ensureCustomer,
  recordStripeEvent,
  startCheckout,
  type BillingGateway,
} from "@foliomind/domain";
import {
  fakeStripe,
  paidInvoice,
  subscription,
  TEST_PRO_PRICE,
} from "@foliomind/domain/test/billing";
import { createUser, describeWithDatabase, testDb } from "@foliomind/domain/test/db";
import { InngestTestEngine } from "@inngest/test";
import { eq, sql } from "drizzle-orm";
import { Inngest } from "inngest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createReconcileBillingFunction, createSyncStripeFunction } from "./billing";
import type { WorkerADeps } from "./shared";

/*
 * Billing sync in Worker A (Section 10 "Webhook endpoint and durability" and
 * "Access rules and usage"): sync-stripe rebuilds a customer from current
 * Stripe state for each recorded event, so a repeat or a late event changes
 * nothing; reconcile-billing catches what events missed. One in-memory Stripe
 * serves the whole file, so any customer a sweep finds has consistent state.
 */

const stripe = fakeStripe();
const keys = cacheKeys("development");
const deletedKeys: string[] = [];
const sent: { name: string; id?: string; data: Record<string, unknown> }[] = [];
const server = setupServer(
  http.post("https://inngest.test/e/:key", async ({ request }) => {
    const events = (await request.json()) as typeof sent;
    sent.push(...events);
    return HttpResponse.json({ ids: events.map(() => randomUUID()), status: 200 });
  }),
);

function deps(db: Database, gateway: BillingGateway | null = stripe.gateway) {
  return {
    db,
    concurrency: { ingestion: 1, imports: 2, control: 2 },
    outboxCron: "0 * * * *",
    billingCron: "0 * * * *",
    billing: gateway ? { gateway, proPriceId: TEST_PRO_PRICE } : null,
    identityAdmin: null,
    cache: {
      redis: {
        del: async (...names: string[]) => {
          deletedKeys.push(...names);
          return names.length;
        },
      },
      keys,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as WorkerADeps;
}

function inngest() {
  return new Inngest({
    id: "billing-test",
    isDev: false,
    eventKey: "test",
    baseUrl: "https://inngest.test",
  });
}

const syncEngine = (db: Database, gateway?: BillingGateway | null) =>
  new InngestTestEngine({ function: createSyncStripeFunction(inngest(), deps(db, gateway)) });
const reconcileEngine = (db: Database) =>
  new InngestTestEngine({ function: createReconcileBillingFunction(inngest(), deps(db)) });

async function customer(db: Database) {
  const user = await createUser(db);
  const customerId = await ensureCustomer(db, stripe.gateway, user);
  return { user, customerId };
}

/** What the webhook route does for a verified event: one row plus its outbox event. */
async function recorded(
  db: Database,
  eventType: string,
  ids: { customerId: string | null; objectId: string | null },
) {
  const eventId = `evt_${randomUUID().slice(0, 12)}`;
  const { eventKey } = await recordStripeEvent(db, {
    id: eventId,
    type: eventType,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    ...ids,
  });
  return {
    name: EVENT_NAMES.billingStripeWebhookRecorded,
    data: { eventId, eventType, ...ids, operationKey: eventKey! },
  };
}

async function eventStatus(db: Database, eventId: string) {
  const [row] = await db
    .select({ status: webhookEvents.status })
    .from(webhookEvents)
    .where(eq(webhookEvents.providerEventId, eventId));
  return row?.status;
}

describeWithDatabase("sync-stripe", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    server.resetHandlers();
    sent.length = 0;
    deletedKeys.length = 0;
  });
  afterAll(() => server.close());

  it("grants Pro from a paid invoice, drops the snapshot and marks the event processed", async () => {
    const db = testDb();
    const { user, customerId } = await customer(db);
    const sub = subscription(customerId, user.id);
    const invoice = paidInvoice(sub);
    stripe.state.subscriptions.set(customerId, [sub]);
    stripe.state.invoices.set(sub.id, [invoice]);

    const event = await recorded(db, "invoice.paid", { customerId, objectId: invoice.id });
    const { result } = await syncEngine(db).execute({ events: [event] });
    expect(result).toEqual({ planCode: "pro", planChanged: true });
    expect(await effectivePlanCode(db, user.id)).toBe("pro");
    expect(deletedKeys).toContain(keys.userSnapshot(user.id));
    expect(await eventStatus(db, event.data.eventId)).toBe("processed");

    // Stripe retries the same delivery: nothing runs twice.
    const { result: again } = await syncEngine(db).execute({ events: [event] });
    expect(again).toEqual({ skipped: "already processed" });
  });

  it("lets no late or repeated event undo newer Stripe state", async () => {
    const db = testDb();
    const { user, customerId } = await customer(db);
    const sub = subscription(customerId, user.id);
    stripe.state.subscriptions.set(customerId, [sub]);
    stripe.state.invoices.set(sub.id, [paidInvoice(sub)]);
    const created = await recorded(db, "customer.subscription.created", {
      customerId,
      objectId: sub.id,
    });

    // The subscription ends before its "created" event is processed.
    sub.status = "canceled";
    const deleted = await recorded(db, "customer.subscription.deleted", {
      customerId,
      objectId: sub.id,
    });
    const first = await syncEngine(db).execute({ events: [deleted] });
    expect(first.result).toMatchObject({ planCode: "free" });

    const late = await syncEngine(db).execute({ events: [created] });
    expect(late.result).toEqual({ planCode: "free", planChanged: false });
    expect(await effectivePlanCode(db, user.id)).toBe("free");
  });

  it("tells the user once about a failed renewal while paid access lasts", async () => {
    const db = testDb();
    const { user, customerId } = await customer(db);
    const sub = subscription(customerId, user.id, { status: "past_due" });
    const failed = paidInvoice(sub, {
      id: `in_${randomUUID().slice(0, 12)}`,
      status: "open",
      amountPaid: 0,
    });
    stripe.state.subscriptions.set(customerId, [sub]);
    stripe.state.invoices.set(sub.id, [paidInvoice(sub), failed]);

    const event = await recorded(db, "invoice.payment_failed", { customerId, objectId: failed.id });
    const { result } = await syncEngine(db).execute({ events: [event] });
    expect(result).toMatchObject({ planCode: "pro" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: EVENT_NAMES.notificationCreated,
      id: `billing-payment_failed:${failed.id}`,
      data: { userId: user.id, type: "payment_failed" },
    });
  });

  it("finds the customer through the Checkout Session and completes the attempt", async () => {
    const db = testDb();
    const user = await createUser(db);
    const outcome = await startCheckout(db, stripe.gateway, {
      userId: user.id,
      priceId: TEST_PRO_PRICE,
      successUrl: "https://folio.test/dashboard/billing?checkout=returned",
      cancelUrl: "https://folio.test/pricing?checkout=cancelled",
    });
    expect(outcome.ok).toBe(true);
    const [attempt] = await db
      .select()
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.userId, user.id));
    const session = stripe.state.sessions.get(attempt!.stripeSessionId!)!;
    const sub = subscription(session.customerId!, user.id);
    stripe.state.subscriptions.set(session.customerId!, [sub]);
    stripe.state.invoices.set(sub.id, [paidInvoice(sub)]);
    Object.assign(session, { status: "complete", paymentStatus: "paid", subscriptionId: sub.id });

    // The completed-session event carries no customer of its own here.
    const event = await recorded(db, "checkout.session.completed", {
      customerId: null,
      objectId: session.id,
    });
    const { result } = await syncEngine(db).execute({ events: [event] });
    expect(result).toEqual({ planCode: "pro", planChanged: true });
    const [after] = await db
      .select({ status: billingCheckoutAttempts.status })
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.id, attempt!.id));
    expect(after?.status).toBe("complete");
  });

  it("marks an event with no customer as ignored", async () => {
    const db = testDb();
    const event = await recorded(db, "customer.subscription.updated", {
      customerId: null,
      objectId: null,
    });
    const { result } = await syncEngine(db).execute({ events: [event] });
    expect(result).toEqual({ skipped: "no customer" });
    expect(await eventStatus(db, event.data.eventId)).toBe("ignored");
  });

  it("refuses to run without Stripe configured, granting nothing", async () => {
    const db = testDb();
    const { user, customerId } = await customer(db);
    const event = await recorded(db, "invoice.paid", { customerId, objectId: "in_none" });
    const { error } = await syncEngine(db, null).execute({ events: [event] });
    expect(error).toBeTruthy();
    expect(await effectivePlanCode(db, user.id)).toBe("free");
  });
});

describeWithDatabase("reconcile-billing", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    server.resetHandlers();
    deletedKeys.length = 0;
  });
  afterAll(() => server.close());

  it("re-syncs a customer whose webhook never finished", async () => {
    const db = testDb();
    const { user, customerId } = await customer(db);
    const sub = subscription(customerId, user.id);
    stripe.state.subscriptions.set(customerId, [sub]);
    stripe.state.invoices.set(sub.id, [paidInvoice(sub)]);
    const event = await recorded(db, "invoice.paid", { customerId, objectId: "in_missed" });
    await db
      .update(webhookEvents)
      .set({ status: "failed", receivedAt: sql`now() - interval '20 minutes'` })
      .where(eq(webhookEvents.providerEventId, event.data.eventId));

    const { result } = await reconcileEngine(db).execute();
    expect(result).toMatchObject({ changed: expect.any(Number) });
    expect(await effectivePlanCode(db, user.id)).toBe("pro");
    expect(await eventStatus(db, event.data.eventId)).toBe("processed");
    expect(deletedKeys).toContain(keys.userSnapshot(user.id));
  });

  it("settles a Checkout attempt Stripe expired without telling us", async () => {
    const db = testDb();
    const user = await createUser(db);
    await startCheckout(db, stripe.gateway, {
      userId: user.id,
      priceId: TEST_PRO_PRICE,
      successUrl: "https://folio.test/dashboard/billing?checkout=returned",
      cancelUrl: "https://folio.test/pricing?checkout=cancelled",
    });
    const [attempt] = await db
      .update(billingCheckoutAttempts)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(eq(billingCheckoutAttempts.userId, user.id))
      .returning();
    stripe.state.sessions.get(attempt!.stripeSessionId!)!.status = "expired";

    await reconcileEngine(db).execute();
    const [after] = await db
      .select({ status: billingCheckoutAttempts.status })
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.id, attempt!.id));
    expect(after?.status).toBe("expired");
    expect(await effectivePlanCode(db, user.id)).toBe("free");
  });
});
