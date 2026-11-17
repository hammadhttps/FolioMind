import type Stripe from "stripe";

/*
 * What billing needs from Stripe, as plain records (blueprint Section 10). The
 * domain logic depends on this interface, so tests use a fake and never call
 * Stripe; `createStripeGateway` is the real implementation. Subscription
 * periods come from the subscription items and invoice periods from their
 * subscription lines, as the pinned API version reports them.
 */

export interface StripeSubscriptionRecord {
  id: string;
  customerId: string;
  status: string;
  priceIds: string[];
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  created: Date;
  /** FolioMind's user ID from the subscription metadata, set at Checkout. */
  userId: string | null;
}

export interface StripeInvoiceRecord {
  id: string;
  subscriptionId: string | null;
  status: string;
  amountPaid: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  hostedInvoiceUrl: string | null;
}

export interface CheckoutSessionRecord {
  id: string;
  status: "open" | "complete" | "expired";
  paymentStatus: string;
  url: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  expiresAt: Date;
  userId: string | null;
}

export interface PriceRecord {
  id: string;
  unitAmount: number;
  currency: string;
  interval: string;
  active: boolean;
  livemode: boolean;
}

export interface BillingGateway {
  createCustomer(input: { userId: string; email: string }): Promise<string>;
  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<CheckoutSessionRecord>;
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionRecord>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  listSubscriptions(customerId: string): Promise<StripeSubscriptionRecord[]>;
  listInvoices(subscriptionId: string): Promise<StripeInvoiceRecord[]>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  retrievePrice(priceId: string): Promise<PriceRecord>;
}

const fromUnix = (seconds: number) => new Date(seconds * 1000);
const idOf = (value: string | { id: string } | null | undefined) =>
  value ? (typeof value === "string" ? value : value.id) : null;

function toSession(session: Stripe.Checkout.Session): CheckoutSessionRecord {
  return {
    id: session.id,
    status: (session.status ?? "open") as CheckoutSessionRecord["status"],
    paymentStatus: session.payment_status,
    url: session.url ?? null,
    customerId: idOf(session.customer),
    subscriptionId: idOf(session.subscription),
    expiresAt: fromUnix(session.expires_at),
    userId: session.metadata?.userId ?? session.client_reference_id ?? null,
  };
}

function toSubscription(subscription: Stripe.Subscription): StripeSubscriptionRecord {
  const items = subscription.items.data;
  const starts = items.map((item) => item.current_period_start);
  const ends = items.map((item) => item.current_period_end);
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer) ?? "",
    status: subscription.status,
    priceIds: items.map((item) => item.price.id),
    periodStart: fromUnix(starts.length ? Math.min(...starts) : subscription.start_date),
    periodEnd: fromUnix(ends.length ? Math.max(...ends) : subscription.start_date),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    created: fromUnix(subscription.created),
    userId: subscription.metadata?.userId ?? null,
  };
}

function toInvoice(invoice: Stripe.Invoice): StripeInvoiceRecord {
  const lines = invoice.lines.data.filter(
    (line) => line.parent?.type === "subscription_item_details",
  );
  const starts = lines.map((line) => line.period.start);
  const ends = lines.map((line) => line.period.end);
  return {
    id: invoice.id ?? "",
    subscriptionId: idOf(invoice.parent?.subscription_details?.subscription ?? null),
    status: invoice.status ?? "draft",
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    periodStart: fromUnix(starts.length ? Math.min(...starts) : invoice.period_start),
    periodEnd: fromUnix(ends.length ? Math.max(...ends) : invoice.period_end),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  };
}

export function createStripeGateway(stripe: Stripe): BillingGateway {
  return {
    async createCustomer({ userId, email }) {
      // One customer per user: a repeat within Stripe's idempotency window returns the same one.
      const customer = await stripe.customers.create(
        { email, metadata: { userId } },
        { idempotencyKey: `customer:${userId}` },
      );
      return customer.id;
    },
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: input.customerId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          client_reference_id: input.userId,
          metadata: { userId: input.userId },
          subscription_data: { metadata: { userId: input.userId } },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          // The one configured price, in its own currency, as Pricing shows it (Section 10);
          // Stripe's Adaptive Pricing would otherwise convert it to the visitor's currency.
          adaptive_pricing: { enabled: false },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return toSession(session);
    },
    async retrieveCheckoutSession(sessionId) {
      return toSession(await stripe.checkout.sessions.retrieve(sessionId));
    },
    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },
    async listSubscriptions(customerId) {
      const page = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      return page.data.map(toSubscription);
    },
    async listInvoices(subscriptionId) {
      const page = await stripe.invoices.list({ subscription: subscriptionId, limit: 24 });
      return page.data.map(toInvoice);
    },
    async cancelSubscription(subscriptionId) {
      await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
    },
    async retrievePrice(priceId) {
      const price = await stripe.prices.retrieve(priceId);
      return {
        id: price.id,
        unitAmount: price.unit_amount ?? 0,
        currency: price.currency,
        interval: price.recurring?.interval ?? "month",
        active: price.active,
        livemode: price.livemode,
      };
    },
  };
}
