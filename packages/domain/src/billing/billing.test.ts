import { randomUUID } from "node:crypto";
import { EVENT_NAMES } from "@foliomind/contracts";
import {
  assets,
  billingCheckoutAttempts,
  documents,
  outboxEvents,
  usageBuckets,
  users,
  webhookEvents,
} from "@foliomind/db";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anonymizeDeletedAccounts,
  deletionsToFinish,
  markIdentityDeleted,
  markSubscriptionCancelled,
  requestAccountDeletion,
} from "../account";
import { markAssetsDeleted } from "../documents";
import { currentEntitlement, effectivePlanCode } from "../entitlements";
import { createBook, createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import { commit, reserve } from "../usage";
import {
  billingSnapshot,
  recordStripeEvent,
  startCheckout,
  syncCheckoutSession,
  syncCustomer,
  type BillingGateway,
  type CheckoutSessionRecord,
  type StripeInvoiceRecord,
  type StripeSubscriptionRecord,
} from "./index";

import {
  DAY,
  fakeStripe,
  paidInvoice,
  subscription,
  TEST_PRO_PRICE as PRICE,
} from "../test/billing";

const urls = {
  successUrl: "https://folio.test/dashboard/billing?checkout=returned",
  cancelUrl: "https://folio.test/pricing?checkout=cancelled",
};

describeWithDatabase("billing (Section 10)", () => {
  let db: ReturnType<typeof testDb>;
  beforeAll(() => {
    db = testDb();
  });

  it("starts one Checkout per user even under concurrent requests", async () => {
    const { gateway, state } = fakeStripe();
    const user = await createUser(db);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        startCheckout(db, gateway, { userId: user.id, priceId: PRICE, ...urls }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const sessionUrls = new Set(results.map((result) => (result.ok ? result.url : "")));
    expect(sessionUrls.size).toBe(1);
    expect(state.sessionsCreated).toBe(1);
    expect(state.customers.size).toBe(1);
    const attempts = await db
      .select()
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.userId, user.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.idempotencyKey).toMatch(new RegExp(`^checkout:${user.id}:`));
  });

  it("refuses unverified, inactive and already-subscribed accounts", async () => {
    const { gateway, state } = fakeStripe();
    const unverified = await createUser(db, { emailVerified: false });
    expect(
      await startCheckout(db, gateway, { userId: unverified.id, priceId: PRICE, ...urls }),
    ).toEqual({
      ok: false,
      code: "email_unverified",
    });
    const suspended = await createUser(db, { status: "suspended" });
    expect(
      await startCheckout(db, gateway, { userId: suspended.id, priceId: PRICE, ...urls }),
    ).toEqual({
      ok: false,
      code: "account_inactive",
    });

    const pro = await createUser(db);
    const first = await startCheckout(db, gateway, { userId: pro.id, priceId: PRICE, ...urls });
    expect(first.ok).toBe(true);
    const customerId = state.customers.get(pro.id)!;
    const sub = subscription(customerId, pro.id);
    state.subscriptions.set(customerId, [sub]);
    state.invoices.set(sub.id, [paidInvoice(sub)]);
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    expect(await startCheckout(db, gateway, { userId: pro.id, priceId: PRICE, ...urls })).toEqual({
      ok: false,
      code: "already_pro",
    });
  });

  it("records each webhook once with its outbox event, and only IDs", async () => {
    const event = {
      id: `evt_${randomUUID().slice(0, 12)}`,
      type: "invoice.paid",
      created: 1_700_000_000,
      livemode: false,
      objectId: "in_123",
      customerId: "cus_123",
    };
    const first = await recordStripeEvent(db, event);
    const again = await recordStripeEvent(db, event);
    expect(first).toEqual({ recorded: true, eventKey: `stripe-event:${event.id}` });
    expect(again).toEqual({ recorded: false, eventKey: null });
    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, `stripe-event:${event.id}`));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.topic).toBe(EVENT_NAMES.billingStripeWebhookRecorded);
    const [row] = await db
      .select({ payload: webhookEvents.payload })
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, event.id));
    expect(Object.keys(row!.payload as object).sort()).toEqual([
      "created",
      "customerId",
      "livemode",
    ]);
  });

  it("derives Pro from current Stripe state: paid, cancel at period end, renewal failure and recovery", async () => {
    const { gateway, state } = fakeStripe();
    const user = await createUser(db);
    const customerId = await gateway.createCustomer({ userId: user.id, email: user.email });
    // Checkout completes, but the subscription isn't paid yet: no Pro on completion alone.
    const sub = subscription(customerId, user.id, { status: "incomplete" });
    state.subscriptions.set(customerId, [sub]);
    let result = await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    expect(result).toMatchObject({ userId: user.id, planCode: "free" });

    // Paid: Pro, with Stripe's billing period as the allowance period.
    sub.status = "active";
    state.invoices.set(sub.id, [paidInvoice(sub)]);
    result = await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    expect(result).toMatchObject({ planCode: "pro", planChanged: true });
    const entitlement = await currentEntitlement(db, user.id);
    expect(entitlement.period.start.getTime()).toBe(sub.periodStart.getTime());
    expect(entitlement.limits.aiQuestionsPerMonth).toBe(500);

    // Syncing again changes nothing (a duplicate or late event is harmless).
    result = await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    expect(result.planChanged).toBe(false);

    // Cancel at period end keeps what was paid for.
    sub.cancelAtPeriodEnd = true;
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    expect(await effectivePlanCode(db, user.id)).toBe("pro");
    const snapshot = await billingSnapshot(db, user.id);
    expect(snapshot.subscription?.cancelAtPeriodEnd).toBe(true);

    // A failed renewal keeps access only until paid-through: the next period is unpaid.
    sub.cancelAtPeriodEnd = false;
    const later = new Date(sub.periodEnd.getTime() + DAY);
    sub.status = "past_due";
    sub.periodStart = sub.periodEnd;
    sub.periodEnd = new Date(sub.periodEnd.getTime() + 30 * DAY);
    state.invoices.get(sub.id)!.push({ ...paidInvoice(sub), status: "open", amountPaid: 0 });
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE, now: later });
    expect(await effectivePlanCode(db, user.id, later)).toBe("free");
    expect((await billingSnapshot(db, user.id, later)).paymentIssue).toBe("payment_failed");

    // The payment later succeeds: Pro is restored.
    const invoices = state.invoices.get(sub.id)!;
    invoices[invoices.length - 1]!.status = "paid";
    sub.status = "active";
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE, now: later });
    expect(await effectivePlanCode(db, user.id, later)).toBe("pro");
  });

  it("never grants Pro for unpaid, paused, other prices or a cancelled subscription", async () => {
    for (const overrides of [
      { status: "unpaid" },
      { status: "paused" },
      { status: "incomplete_expired" },
      { priceIds: ["price_someone_else"] },
    ] satisfies Partial<StripeSubscriptionRecord>[]) {
      const { gateway, state } = fakeStripe();
      const user = await createUser(db);
      const customerId = await gateway.createCustomer({ userId: user.id, email: user.email });
      const sub = subscription(customerId, user.id, overrides);
      state.subscriptions.set(customerId, [sub]);
      state.invoices.set(sub.id, [paidInvoice(sub)]);
      const result = await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
      expect(result.planCode, JSON.stringify(overrides)).toBe("free");
    }
  });

  it("cancels a duplicate live subscription instead of billing twice", async () => {
    const { gateway, state } = fakeStripe();
    const user = await createUser(db);
    const customerId = await gateway.createCustomer({ userId: user.id, email: user.email });
    const first = subscription(customerId, user.id, { created: new Date(Date.now() - 2 * DAY) });
    const second = subscription(customerId, user.id, { created: new Date(Date.now() - DAY) });
    state.subscriptions.set(customerId, [second, first]);
    state.invoices.set(first.id, [paidInvoice(first)]);
    state.invoices.set(second.id, [paidInvoice(second)]);
    const result = await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    expect(result.cancelledDuplicates).toEqual([second.id]);
    expect(result.planCode).toBe("pro");
  });

  it("carries this month's Free usage into the first Pro period, not into renewals", async () => {
    const { gateway, state } = fakeStripe();
    const user = await createUser(db);
    const now = new Date();
    for (let index = 0; index < 3; index += 1) {
      const key = `test-carry:${user.id}:${index}`;
      expect(
        (
          await reserve(db, {
            userId: user.id,
            metric: "ai_questions",
            quantity: 1,
            operationKey: key,
            now,
          })
        ).ok,
      ).toBe(true);
      await commit(db, key);
    }
    const customerId = await gateway.createCustomer({ userId: user.id, email: user.email });
    // Pro starts mid-month, inside the Free bucket's month.
    const sub = subscription(customerId, user.id, {
      periodStart: new Date(now.getTime() - 60 * 1000),
      periodEnd: new Date(now.getTime() + 30 * DAY),
    });
    state.subscriptions.set(customerId, [sub]);
    state.invoices.set(sub.id, [paidInvoice(sub)]);
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    const key = `test-carry:${user.id}:pro`;
    expect(
      (
        await reserve(db, {
          userId: user.id,
          metric: "ai_questions",
          quantity: 1,
          operationKey: key,
        })
      ).ok,
    ).toBe(true);
    const [proBucket] = await db
      .select({ consumed: usageBuckets.consumed, limit: usageBuckets.limit })
      .from(usageBuckets)
      .where(
        and(
          eq(usageBuckets.userId, user.id),
          eq(usageBuckets.metric, "ai_questions"),
          eq(usageBuckets.periodStart, sub.periodStart),
        ),
      );
    expect(proBucket).toEqual({ consumed: 3, limit: 500 });

    // The renewal starts where the period ended: nothing carries.
    const renewal = new Date(sub.periodEnd.getTime() + 1000);
    sub.periodStart = sub.periodEnd;
    sub.periodEnd = new Date(sub.periodEnd.getTime() + 30 * DAY);
    state.invoices.get(sub.id)!.push(paidInvoice(sub));
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE, now: renewal });
    const renewalKey = `test-carry:${user.id}:renewal`;
    await reserve(db, {
      userId: user.id,
      metric: "ai_questions",
      quantity: 1,
      operationKey: renewalKey,
      now: renewal,
    });
    const [next] = await db
      .select({ consumed: usageBuckets.consumed })
      .from(usageBuckets)
      .where(and(eq(usageBuckets.userId, user.id), eq(usageBuckets.periodStart, sub.periodStart)));
    expect(next?.consumed).toBe(0);
  });

  it("settles Checkout sessions and shows Payment pending until the sync confirms", async () => {
    const { gateway, state } = fakeStripe();
    const user = await createUser(db);
    const started = await startCheckout(db, gateway, { userId: user.id, priceId: PRICE, ...urls });
    expect(started.ok).toBe(true);
    const session = [...state.sessions.values()].at(-1)!;
    session.status = "complete";
    await syncCheckoutSession(db, session);
    expect((await billingSnapshot(db, user.id)).pendingCheckout).toBe(true);
    const customerId = state.customers.get(user.id)!;
    const sub = subscription(customerId, user.id);
    state.subscriptions.set(customerId, [sub]);
    state.invoices.set(sub.id, [paidInvoice(sub)]);
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });
    const snapshot = await billingSnapshot(db, user.id);
    expect(snapshot).toMatchObject({ planCode: "pro", pendingCheckout: false, hasCustomer: true });
    expect(snapshot.invoices).toHaveLength(1);
    // A finished attempt never reopens.
    session.status = "open";
    await syncCheckoutSession(db, session);
    const [attempt] = await db
      .select({ status: billingCheckoutAttempts.status })
      .from(billingCheckoutAttempts)
      .where(eq(billingCheckoutAttempts.userId, user.id));
    expect(attempt?.status).toBe("complete");
  });
});

describeWithDatabase("account deletion (Section 6)", () => {
  it("revokes access at once, then finishes externally and anonymizes", async () => {
    const db = testDb();
    const { gateway, state } = fakeStripe();
    const user = await createUser(db);
    const { document, version } = await createDocument(db, user.id);
    const customerId = await gateway.createCustomer({ userId: user.id, email: user.email });
    await db.execute(
      sql`insert into billing_customers (user_id, stripe_customer_id) values (${user.id}, ${customerId})`,
    );
    const sub = subscription(customerId, user.id);
    state.subscriptions.set(customerId, [sub]);
    state.invoices.set(sub.id, [paidInvoice(sub)]);
    await syncCustomer(db, gateway, { customerId, proPriceId: PRICE });

    // The user also publishes a book that's live.
    const { book } = await createBook(db, version.id, { published: true });
    await db.execute(sql`update publisher_profiles set user_id = ${user.id}
      where id = (select publisher_id from books where id = ${book.id})`);

    const admin = await createUser(db, { role: "admin" });
    expect(await requestAccountDeletion(db, { userId: admin.id })).toEqual({
      ok: false,
      code: "admin_account",
    });

    const outcome = await requestAccountDeletion(db, { userId: user.id });
    expect(outcome).toMatchObject({ ok: true, subscriptionIds: [sub.id], bookIds: [book.id] });
    if (!outcome.ok) return;
    expect(await requestAccountDeletion(db, { userId: user.id })).toEqual({
      ok: false,
      code: "already_deleting",
    });
    const [row] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.status).toBe("deleting");
    const [doc] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(doc?.status).toBe("deleting");
    const [bookRow] = await db.execute<{ status: string }>(
      sql`select status from books where id = ${book.id}`,
    );
    expect(bookRow?.status).toBe("unpublished");
    expect(outcome.fileKeys.length).toBeGreaterThan(0);

    // Nothing anonymized while the subscription and identity remain.
    expect(await deletionsToFinish(db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: user.id, subscriptionIds: [sub.id] }),
      ]),
    );
    expect(await anonymizeDeletedAccounts(db)).toBe(0);

    await gateway.cancelSubscription(sub.id);
    await markSubscriptionCancelled(db, sub.id);
    await markIdentityDeleted(db, user.id);
    expect(await anonymizeDeletedAccounts(db)).toBe(0); // files still being deleted
    await markAssetsDeleted(db, outcome.fileKeys);
    const remaining = await db
      .select({ key: assets.fileKey })
      .from(assets)
      .where(and(eq(assets.ownerId, user.id), sql`${assets.state} <> 'deleted'`));
    expect(remaining).toEqual([]);
    expect(await anonymizeDeletedAccounts(db)).toBeGreaterThanOrEqual(1);
    const [gone] = await db
      .select({
        email: users.email,
        name: users.displayName,
        deletedAt: users.deletedAt,
        sub: users.auth0Sub,
      })
      .from(users)
      .where(eq(users.id, user.id));
    expect(gone).toMatchObject({
      email: `deleted-${user.id}@deleted.invalid`,
      name: "Deleted account",
      sub: `deleted|${user.id}`,
    });
    expect(gone?.deletedAt).not.toBeNull();
    expect(state.cancelled).toContain(sub.id);
    const audit = await db.execute<{ action: string }>(sql`
      select action from audit_logs where target_id = ${user.id} order by created_at`);
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["user.deletion_requested", "user.identity_deleted", "user.deleted"]),
    );
  });
});

describe("paid-through", () => {
  it("is the latest period covered by a paid invoice of that subscription", async () => {
    const { paidThroughFrom } = await import("./sync");
    const sub = subscription("cus_x", "user_x");
    const older = paidInvoice(sub, { periodEnd: new Date(Date.now() - DAY) });
    const open = paidInvoice(sub, { status: "open", periodEnd: new Date(Date.now() + 60 * DAY) });
    const other = paidInvoice(sub, {
      subscriptionId: "sub_other",
      periodEnd: new Date(Date.now() + 90 * DAY),
    });
    expect(paidThroughFrom(sub.id, [older, open, other])).toEqual(older.periodEnd);
    expect(paidThroughFrom(sub.id, [open])).toBeNull();
  });
});
