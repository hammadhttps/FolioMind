import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, timestamptz } from "./columns";
import {
  SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
  usageOperationStatus,
} from "./enums";
import { inValues } from "./columns";
import { users } from "./identity";
import { jobs } from "./operations";

/* Section 12 "Billing and operations": plans, Stripe mirrors and usage quotas. */

/** Limits are versioned JSON; see `planLimitsSchema` in @foliomind/contracts. */
export const plans = pgTable("plans", {
  code: text("code").primaryKey(),
  stripePriceId: text("stripe_price_id").unique(),
  limits: jsonb("limits").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps(),
});

export const billingCustomers = pgTable("billing_customers", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  ...timestamps(),
});

export const billingCheckoutAttempts = pgTable(
  "billing_checkout_attempts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    stripeSessionId: text("stripe_session_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull(),
    expiresAt: timestamptz("expires_at"),
    ...timestamps(),
  },
  (t) => [
    index("billing_checkout_attempts_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    planCode: text("plan_code")
      .notNull()
      .references(() => plans.code),
    status: text("status").notNull(),
    periodStart: timestamptz("period_start").notNull(),
    periodEnd: timestamptz("period_end").notNull(),
    paidThrough: timestamptz("paid_through"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    syncedAt: timestamptz("synced_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    check("subscriptions_status_check", inValues(t.status, SUBSCRIPTION_STATUSES)),
    // One nonterminal subscription per user (Section 12 invariants).
    uniqueIndex("subscriptions_user_nonterminal_key")
      .on(t.userId)
      .where(sql`not (${inValues(t.status, TERMINAL_SUBSCRIPTION_STATUSES)})`),
    index("subscriptions_user_idx").on(t.userId),
  ],
);

export const billingInvoices = pgTable(
  "billing_invoices",
  {
    stripeInvoiceId: text("stripe_invoice_id").primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    status: text("status").notNull(),
    amountPaid: bigint("amount_paid", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    periodStart: timestamptz("period_start").notNull(),
    periodEnd: timestamptz("period_end").notNull(),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    ...timestamps(),
  },
  (t) => [
    check("billing_invoices_amount_paid_check", sql`${t.amountPaid} >= 0`),
    index("billing_invoices_subscription_idx").on(t.subscriptionId),
  ],
);

/**
 * One allowance per user, metric and entitlement period. `reserved + consumed`
 * never exceeds `limit`: reservations increment it with a guarded UPDATE.
 */
export const usageBuckets = pgTable(
  "usage_buckets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    metric: text("metric").notNull(),
    periodStart: timestamptz("period_start").notNull(),
    periodEnd: timestamptz("period_end").notNull(),
    limit: bigint("limit", { mode: "number" }).notNull(),
    reserved: bigint("reserved", { mode: "number" }).notNull().default(0),
    consumed: bigint("consumed", { mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("usage_buckets_user_metric_period_key").on(t.userId, t.metric, t.periodStart),
    check("usage_buckets_limit_check", sql`${t.limit} >= 0`),
    check("usage_buckets_reserved_check", sql`${t.reserved} >= 0`),
    check("usage_buckets_consumed_check", sql`${t.consumed} >= 0`),
    check("usage_buckets_period_check", sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

export const usageOperations = pgTable(
  "usage_operations",
  {
    id: id(),
    bucketId: uuid("bucket_id")
      .notNull()
      .references(() => usageBuckets.id),
    operationKey: text("operation_key").notNull().unique(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    status: usageOperationStatus("status").notNull().default("reserved"),
    expiresAt: timestamptz("expires_at"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    check("usage_operations_quantity_check", sql`${t.quantity} > 0`),
    index("usage_operations_bucket_idx").on(t.bucketId),
    // Expiry sweep of abandoned reservations.
    index("usage_operations_reserved_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'reserved'`),
  ],
);

/** Minimize and expire payloads (Section 12). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    providerEventId: text("provider_event_id").primaryKey(),
    type: text("type").notNull(),
    objectId: text("object_id"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    processedAt: timestamptz("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
  },
  (t) => [
    check("webhook_events_attempts_check", sql`${t.attempts} >= 0`),
    index("webhook_events_status_received_idx").on(t.status, t.receivedAt),
  ],
);
