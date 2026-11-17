import { randomUUID } from "node:crypto";
import type {
  BillingGateway,
  CheckoutSessionRecord,
  StripeInvoiceRecord,
  StripeSubscriptionRecord,
} from "../billing";

/*
 * Billing test helpers (Section 10): an in-memory Stripe behind the
 * BillingGateway interface, and builders for the subscription and invoice
 * records the sync reads. Shared by the domain and workflow tests.
 */

export const TEST_PRO_PRICE = "price_test_pro";
export const DAY = 24 * 60 * 60 * 1000;

/** An in-memory Stripe: enough state for the sync to rebuild from. */
export function fakeStripe() {
  const state = {
    customers: new Map<string, string>(),
    sessions: new Map<string, CheckoutSessionRecord>(),
    subscriptions: new Map<string, StripeSubscriptionRecord[]>(),
    invoices: new Map<string, StripeInvoiceRecord[]>(),
    cancelled: [] as string[],
    sessionsCreated: 0,
  };
  const gateway: BillingGateway = {
    async createCustomer({ userId }) {
      const existing = state.customers.get(userId);
      if (existing) return existing;
      const id = `cus_${randomUUID().slice(0, 12)}`;
      state.customers.set(userId, id);
      return id;
    },
    async createCheckoutSession(input) {
      state.sessionsCreated += 1;
      // Slow enough that concurrent requests overlap.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const session: CheckoutSessionRecord = {
        id: `cs_${randomUUID().slice(0, 12)}`,
        status: "open",
        paymentStatus: "unpaid",
        url: `https://checkout.stripe.test/${randomUUID()}`,
        customerId: input.customerId,
        subscriptionId: null,
        expiresAt: new Date(Date.now() + DAY),
        userId: input.userId,
      };
      state.sessions.set(session.id, session);
      return session;
    },
    async retrieveCheckoutSession(id) {
      const session = state.sessions.get(id);
      if (!session) throw new Error("no such session");
      return session;
    },
    async createPortalSession() {
      return { url: "https://billing.stripe.test/portal" };
    },
    async listSubscriptions(customerId) {
      return (state.subscriptions.get(customerId) ?? []).map((row) => ({ ...row }));
    },
    async listInvoices(subscriptionId) {
      return state.invoices.get(subscriptionId) ?? [];
    },
    async cancelSubscription(id) {
      state.cancelled.push(id);
      for (const rows of state.subscriptions.values()) {
        for (const row of rows) if (row.id === id) row.status = "canceled";
      }
    },
    async retrievePrice(id) {
      return {
        id,
        unitAmount: 900,
        currency: "usd",
        interval: "month",
        active: true,
        livemode: false,
      };
    },
  };
  return { gateway, state };
}

export function subscription(
  customerId: string,
  userId: string,
  overrides: Partial<StripeSubscriptionRecord> = {},
): StripeSubscriptionRecord {
  const now = Date.now();
  return {
    id: `sub_${randomUUID().slice(0, 12)}`,
    customerId,
    status: "active",
    priceIds: [TEST_PRO_PRICE],
    periodStart: new Date(now - 5 * DAY),
    periodEnd: new Date(now + 25 * DAY),
    cancelAtPeriodEnd: false,
    created: new Date(now - 5 * DAY),
    userId,
    ...overrides,
  };
}

export function paidInvoice(
  sub: StripeSubscriptionRecord,
  overrides: Partial<StripeInvoiceRecord> = {},
) {
  return {
    id: `in_${randomUUID().slice(0, 12)}`,
    subscriptionId: sub.id,
    status: "paid",
    amountPaid: 900,
    currency: "usd",
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd,
    hostedInvoiceUrl: "https://invoice.stripe.test/x",
    ...overrides,
  } satisfies StripeInvoiceRecord;
}
