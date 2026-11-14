import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, inValues, timestamps, timestamptz } from "./columns";
import { JOB_STATUSES } from "./enums";
import { users } from "./identity";
import { books } from "./publishing";

/* Section 12 "Billing and operations": jobs, outbox, AI runs, notifications and audit. */

/** What users and admins see about a long operation; Inngest keeps run and step state. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    ownerId: uuid("owner_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    targetId: uuid("target_id"),
    operationKey: text("operation_key").notNull().unique(),
    inngestEventId: text("inngest_event_id"),
    inngestRunId: text("inngest_run_id"),
    status: text("status").notNull().default("queued"),
    phase: text("phase").notNull().default("queued"),
    progress: jsonb("progress"),
    attempts: integer("attempts").notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    safeErrorCode: text("safe_error_code"),
    result: jsonb("result").notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check("jobs_status_check", inValues(t.status, JOB_STATUSES)),
    check("jobs_attempts_check", sql`${t.attempts} >= 0`),
    index("jobs_owner_created_idx").on(
      t.ownerId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // Admin jobs list (Section 24).
    index("jobs_created_idx").on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("jobs_status_created_idx").on(t.status, t.createdAt.desc().nullsFirst()),
    index("jobs_kind_target_idx").on(t.kind, t.targetId),
  ],
);

/** Event keys double as Inngest event IDs (Section 3). */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    eventKey: text("event_key").notNull().unique(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    availableAt: timestamptz("available_at").notNull().defaultNow(),
    leaseUntil: timestamptz("lease_until"),
    deliveredAt: timestamptz("delivered_at"),
    attempts: integer("attempts").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check("outbox_events_attempts_check", sql`${t.attempts} >= 0`),
    // The dispatcher only scans undelivered rows.
    index("outbox_events_pending_idx")
      .on(t.availableAt)
      .where(sql`${t.deliveredAt} is null`),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    estimatedCost: numeric("estimated_cost"),
    latencyMs: integer("latency_ms").notNull(),
    status: text("status").notNull(),
    retrievalMetadata: jsonb("retrieval_metadata").notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check(
      "ai_runs_counts_check",
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.latencyMs} >= 0`,
    ),
    index("ai_runs_user_created_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
    index("ai_runs_job_idx").on(t.jobId),
    // Admin usage and cost by day (Section 5 row 15).
    index("ai_runs_created_idx").on(t.createdAt.desc().nullsFirst()),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    safeBody: text("safe_body").notNull(),
    targetPath: text("target_path").notNull(),
    readAt: timestamptz("read_at"),
    ...timestamps(),
  },
  (t) => [
    unique("notifications_user_event_key").on(t.userId, t.eventKey),
    // Notification drawer: newest first, optionally unread only (Section 24).
    index("notifications_user_created_idx").on(
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.readAt} is null`),
  ],
);

export const pushDevices = pgTable(
  "push_devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerSubscriberId: text("provider_subscriber_id").notNull().unique(),
    consentAt: timestamptz("consent_at").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("push_devices_user_idx").on(t.userId)],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    pushDeviceId: uuid("push_device_id")
      .notNull()
      .references(() => pushDevices.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamptz("sent_at"),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.notificationId, t.pushDeviceId] }),
    check("notification_deliveries_attempts_check", sql`${t.attempts} >= 0`),
    index("notification_deliveries_device_idx").on(t.pushDeviceId),
  ],
);

/**
 * Append-only: the runtime role has no UPDATE or DELETE on this table. No FK on
 * actor_id, so audit history outlives account cleanup (Section 12 retention).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    safeMetadata: jsonb("safe_metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    // Admin audit log: newest first (Section 24).
    index("audit_logs_created_idx").on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt.desc().nullsFirst()),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    // Admin audit log filtered by action.
    index("audit_logs_action_created_idx").on(
      t.action,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);

/** Aggregate counts only, never query text. */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    reads: bigint("reads", { mode: "number" }).notNull().default(0),
    saves: bigint("saves", { mode: "number" }).notNull().default(0),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.date] }),
    check("analytics_daily_counts_check", sql`${t.reads} >= 0 and ${t.saves} >= 0`),
  ],
);
