import { z } from "zod";
import { PLAN_CODES } from "./plans";

/*
 * Billing (blueprint Sections 6, 10 and 11). Stripe hosts Checkout and the
 * Customer Portal; FolioMind keeps a snapshot synchronized from webhooks and
 * never grants Pro because a browser visited a success URL. Stripe stays in
 * test mode (user decision, 2026-11-04), so no real charges are made.
 */

/** Subscription statuses that can carry paid access while `paid_through` lasts. */
export const PAID_ACCESS_STATUSES = ["active", "trialing", "past_due"] as const;

/** Statuses that never start or keep Pro access (Section 10 "Access rules"). */
export const NO_ACCESS_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "canceled",
  "unpaid",
  "paused",
] as const;

export const CHECKOUT_ATTEMPT_STATUSES = ["open", "complete", "expired", "failed"] as const;
export type CheckoutAttemptStatus = (typeof CHECKOUT_ATTEMPT_STATUSES)[number];

/** Server-side price allowlist: the browser only names a plan, never a price or amount. */
export const checkoutRequestSchema = z.object({ plan: z.literal("pro") });

/** Stripe webhook events FolioMind handles (Section 10 event table). */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;
export type StripeWebhookEvent = (typeof STRIPE_WEBHOOK_EVENTS)[number];

export const BILLING_REFUSALS = {
  not_configured: "Upgrading isn't available yet.",
  account_inactive: "Your account can't do this right now.",
  email_unverified:
    "Verify your email address with your sign-in provider before upgrading. Then sign in again.",
  already_pro: "You already have FolioMind Pro. Manage it from Billing.",
  payment_pending: "A Pro payment is already in progress. Open Billing to finish it.",
  no_customer: "There's no billing account to manage yet.",
  provider_unavailable: "Stripe couldn't be reached. Please try again in a moment.",
} as const;
export type BillingRefusalCode = keyof typeof BILLING_REFUSALS;

/** What Pricing shows about the Pro price, read from Stripe on the server and cached. */
export const proPriceSchema = z.object({
  id: z.string(),
  unitAmount: z.number().int().nonnegative(),
  currency: z.string(),
  interval: z.string(),
  livemode: z.boolean(),
});
export type ProPrice = z.infer<typeof proPriceSchema>;

/** Billing and Usage's view of the account (polled while a payment is pending). */
export const billingSnapshotSchema = z.object({
  planCode: z.enum(PLAN_CODES),
  subscription: z
    .object({
      status: z.string(),
      cancelAtPeriodEnd: z.boolean(),
      periodStart: z.string(),
      periodEnd: z.string(),
      paidThrough: z.string().nullable(),
    })
    .nullable(),
  /** Checkout finished on Stripe's page but the webhook sync hasn't confirmed Pro yet. */
  pendingCheckout: z.boolean(),
  /** A renewal or first payment failed or needs the customer's authentication. */
  paymentIssue: z.enum(["payment_failed", "action_required"]).nullable(),
  hasCustomer: z.boolean(),
  invoices: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      amountPaid: z.number().int(),
      currency: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
      hostedInvoiceUrl: z.string().nullable(),
    }),
  ),
});
export type BillingSnapshot = z.infer<typeof billingSnapshotSchema>;

/* --- Account deletion (Section 6 end states) -------------------------------- */

export const DELETE_ACCOUNT_PHRASE = "delete my account";

export const deleteAccountSchema = z.object({
  confirmation: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === DELETE_ACCOUNT_PHRASE, {
      message: `Type “${DELETE_ACCOUNT_PHRASE}” to confirm.`,
    }),
});
export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;
