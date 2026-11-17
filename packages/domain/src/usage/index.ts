import {
  BOOK_FILE_ROUTES,
  PLAN_LIMITS,
  USAGE_METRICS,
  type QuestionAllowance,
  type UsageMetric,
} from "@foliomind/contracts";
import {
  assets,
  documents,
  usageBuckets,
  usageOperations,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, inArray, isNull, not, notInArray, sql } from "drizzle-orm";
import { currentEntitlement } from "../entitlements";
import { isBookSourceDocument } from "../publishing/records";

/*
 * Postgres allowances (blueprint Section 10). A billable operation reserves its
 * quantity first, then commits or releases it under a unique operation key, so
 * retries never double-charge. The reservation is one guarded UPDATE: the row
 * lock serializes concurrent reservations and the WHERE clause is re-checked
 * after each wait, so a bucket can never be oversubscribed. Redis is not involved.
 */

/** Reservations a crashed caller never resolves are released after this. */
export const DEFAULT_RESERVATION_TTL_MS = 60 * 60 * 1000;

export interface ReserveInput {
  userId: string;
  metric: UsageMetric;
  quantity: number;
  operationKey: string;
  jobId?: string;
  expiresAt?: Date;
  now?: Date;
}

export interface BucketRef {
  userId: string;
  periodStart: Date;
}

export type ReserveResult =
  | ({
      ok: true;
      operationId: string;
      status: "reserved" | "committed";
      replayed: boolean;
    } & BucketRef)
  | { ok: false; code: "quota_exceeded"; limit: number; used: number; resetsAt: Date }
  | { ok: false; code: "operation_released" };

class QuotaExceeded extends Error {
  constructor(
    readonly limit: number,
    readonly used: number,
    readonly resetsAt: Date,
  ) {
    super("quota exceeded");
  }
}

export async function reserve(db: Database, input: ReserveInput): Promise<ReserveResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("Usage quantity must be a positive integer");
  }
  const now = input.now ?? new Date();
  const entitlement = await currentEntitlement(db, input.userId, now);
  const limit = entitlement.limits[USAGE_METRICS[input.metric]];
  const { start: periodStart, end: periodEnd } = entitlement.period;
  const ref: BucketRef = { userId: input.userId, periodStart };

  try {
    return await db.transaction(async (tx) => {
      // Buckets are created lazily, once per user, metric and period. A period
      // that starts inside another one (an upgrade mid-month) begins with what
      // was already consumed there, so switching plans never resets a limit
      // (Section 10). Renewals start where the last period ended: no overlap.
      const carried = sql`(
        select coalesce(sum(previous.consumed), 0) from usage_buckets previous
        where previous.user_id = ${input.userId} and previous.metric = ${input.metric}
          and previous.period_start < ${periodStart.toISOString()}::timestamptz
          and previous.period_end > ${periodStart.toISOString()}::timestamptz)`;
      await tx
        .insert(usageBuckets)
        .values({
          userId: input.userId,
          metric: input.metric,
          periodStart,
          periodEnd,
          limit,
          consumed: carried,
        })
        .onConflictDoNothing({
          target: [usageBuckets.userId, usageBuckets.metric, usageBuckets.periodStart],
        });
      const [bucket] = await tx
        .select({ id: usageBuckets.id })
        .from(usageBuckets)
        .where(
          and(
            eq(usageBuckets.userId, input.userId),
            eq(usageBuckets.metric, input.metric),
            eq(usageBuckets.periodStart, periodStart),
          ),
        );
      if (!bucket) throw new Error("Usage bucket missing after insert");

      const [operation] = await tx
        .insert(usageOperations)
        .values({
          bucketId: bucket.id,
          operationKey: input.operationKey,
          quantity: input.quantity,
          status: "reserved",
          expiresAt: input.expiresAt ?? new Date(now.getTime() + DEFAULT_RESERVATION_TTL_MS),
          jobId: input.jobId ?? null,
        })
        .onConflictDoNothing({ target: usageOperations.operationKey })
        .returning({ id: usageOperations.id });

      if (!operation) {
        // Same operation key again: report the original outcome, charge nothing.
        const [previous] = await tx
          .select({ id: usageOperations.id, status: usageOperations.status })
          .from(usageOperations)
          .where(eq(usageOperations.operationKey, input.operationKey));
        if (!previous || previous.status === "released") {
          return { ok: false, code: "operation_released" } as const;
        }
        return {
          ok: true,
          operationId: previous.id,
          status: previous.status,
          replayed: true,
          ...ref,
        };
      }

      const [updated] = await tx
        .update(usageBuckets)
        .set({ reserved: sql`${usageBuckets.reserved} + ${input.quantity}`, updatedAt: now })
        .where(
          and(
            eq(usageBuckets.id, bucket.id),
            sql`${usageBuckets.reserved} + ${usageBuckets.consumed} + ${input.quantity} <= ${usageBuckets.limit}`,
          ),
        )
        .returning({ id: usageBuckets.id });
      if (!updated) {
        const [current] = await tx
          .select({
            limit: usageBuckets.limit,
            used: sql<number>`(${usageBuckets.reserved} + ${usageBuckets.consumed})::bigint`.mapWith(
              Number,
            ),
            periodEnd: usageBuckets.periodEnd,
          })
          .from(usageBuckets)
          .where(eq(usageBuckets.id, bucket.id));
        // Rolls back the operation row inserted above.
        throw new QuotaExceeded(
          current?.limit ?? limit,
          current?.used ?? 0,
          current?.periodEnd ?? periodEnd,
        );
      }
      return {
        ok: true,
        operationId: operation.id,
        status: "reserved",
        replayed: false,
        ...ref,
      } as const;
    });
  } catch (error) {
    if (error instanceof QuotaExceeded) {
      return {
        ok: false,
        code: "quota_exceeded",
        limit: error.limit,
        used: error.used,
        resetsAt: error.resetsAt,
      };
    }
    throw error;
  }
}

export type ResolveResult =
  | ({ ok: true; replayed: boolean } & BucketRef)
  | { ok: false; code: "operation_not_found" | "operation_released" | "operation_committed" };

async function resolve(
  db: Database,
  operationKey: string,
  outcome: "committed" | "released",
): Promise<ResolveResult> {
  return db.transaction(async (tx) => {
    const [operation] = await tx
      .select({
        id: usageOperations.id,
        status: usageOperations.status,
        quantity: usageOperations.quantity,
        bucketId: usageOperations.bucketId,
        userId: usageBuckets.userId,
        periodStart: usageBuckets.periodStart,
      })
      .from(usageOperations)
      .innerJoin(usageBuckets, eq(usageBuckets.id, usageOperations.bucketId))
      .where(eq(usageOperations.operationKey, operationKey))
      .for("update", { of: usageOperations });
    if (!operation) return { ok: false, code: "operation_not_found" } as const;
    const ref = { userId: operation.userId, periodStart: operation.periodStart };
    if (operation.status === outcome) return { ok: true, replayed: true, ...ref };
    if (operation.status !== "reserved") {
      return {
        ok: false,
        code: operation.status === "released" ? "operation_released" : "operation_committed",
      } as const;
    }

    await tx
      .update(usageOperations)
      .set({ status: outcome })
      .where(eq(usageOperations.id, operation.id));
    await tx
      .update(usageBuckets)
      .set({
        reserved: sql`${usageBuckets.reserved} - ${operation.quantity}`,
        ...(outcome === "committed"
          ? { consumed: sql`${usageBuckets.consumed} + ${operation.quantity}` }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(usageBuckets.id, operation.bucketId));
    return { ok: true, replayed: false, ...ref };
  });
}

/** The operation succeeded: move its reservation into consumption. Idempotent. */
export function commit(db: Database, operationKey: string): Promise<ResolveResult> {
  return resolve(db, operationKey, "committed");
}

/** The operation failed or was cancelled: return its reservation. Idempotent. */
export function release(db: Database, operationKey: string): Promise<ResolveResult> {
  return resolve(db, operationKey, "released");
}

/**
 * Releases reservations whose callers never resolved them (the Phase 6 cleanup
 * cron). Skips rows another sweep holds, so overlapping runs are harmless.
 */
export async function expireAbandoned(
  db: Database,
  { now = new Date(), limit = 500 }: { now?: Date; limit?: number } = {},
): Promise<BucketRef[]> {
  return db.transaction(async (tx) => {
    const expired = await tx.execute<{ bucket_id: string; quantity: string }>(sql`
      update ${usageOperations} set status = 'released', updated_at = now()
      where id in (
        select id from ${usageOperations}
        where status = 'reserved' and expires_at < ${now.toISOString()}
        order by expires_at
        limit ${limit}
        for update skip locked
      )
      returning bucket_id, quantity`);
    if (expired.length === 0) return [];

    const totals = new Map<string, bigint>();
    for (const row of expired) {
      totals.set(row.bucket_id, (totals.get(row.bucket_id) ?? BigInt(0)) + BigInt(row.quantity));
    }
    const touched: BucketRef[] = [];
    for (const [bucketId, quantity] of totals) {
      const [bucket] = await tx
        .update(usageBuckets)
        .set({
          reserved: sql`${usageBuckets.reserved} - ${quantity.toString()}::bigint`,
          updatedAt: now,
        })
        .where(eq(usageBuckets.id, bucketId))
        .returning({ userId: usageBuckets.userId, periodStart: usageBuckets.periodStart });
      if (bucket) touched.push(bucket);
    }
    return touched;
  });
}

/** The composer's discreet count and the upgrade explanation at the limit (Sections 10 and 20). */
export async function questionAllowance(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<QuestionAllowance> {
  const { planCode, limits, period } = await currentEntitlement(db, userId, now);
  const [bucket] = await db
    .select({
      limit: usageBuckets.limit,
      used: sql<number>`(${usageBuckets.reserved} + ${usageBuckets.consumed})::bigint`.mapWith(
        Number,
      ),
    })
    .from(usageBuckets)
    .where(
      and(
        eq(usageBuckets.userId, userId),
        eq(usageBuckets.metric, "ai_questions"),
        eq(usageBuckets.periodStart, period.start),
      ),
    );
  const limit = bucket?.limit ?? limits.aiQuestionsPerMonth;
  const used = bucket?.used ?? 0;
  return {
    planCode,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    proLimit: PLAN_LIMITS.pro.aiQuestionsPerMonth,
    resetsAt: period.end.toISOString(),
  };
}

/** Stored bytes, including exports, of files that are uploading or live (a gauge). */
export async function storageBytesUsed(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<number>`coalesce(sum(${assets.bytes}), 0)::bigint`.mapWith(Number) })
    .from(assets)
    .where(
      and(
        eq(assets.ownerId, userId),
        inArray(assets.state, ["pending", "ready"]),
        // Book sources and covers have the publishing allowance instead (user decision, P9).
        notInArray(assets.fileRoute, [...BOOK_FILE_ROUTES]),
      ),
    );
  return row?.bytes ?? 0;
}

/** Owned source documents, uploads and imports together (a gauge). */
export async function ownedSourceCount(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(documents)
    .where(
      and(
        eq(documents.ownerId, userId),
        eq(documents.status, "active"),
        isNull(documents.deletedAt),
        not(isBookSourceDocument(documents.id)),
      ),
    );
  return row?.count ?? 0;
}

export interface UploadAllowance {
  documents: number;
  documentLimit: number;
  storageBytes: number;
  storageLimitBytes: number;
}

/** The upload dialog's gauge: owned sources and stored bytes against the plan (Section 10). */
export async function uploadAllowance(db: Executor, userId: string): Promise<UploadAllowance> {
  const { limits } = await currentEntitlement(db, userId);
  const [documents, storageBytes] = await Promise.all([
    ownedSourceCount(db, userId),
    storageBytesUsed(db, userId),
  ]);
  return {
    documents,
    documentLimit: limits.ownedSourcePdfs,
    storageBytes,
    storageLimitBytes: limits.storageBytes,
  };
}

export interface UsageOverview {
  planCode: "free" | "pro";
  period: { start: Date; end: Date };
  metrics: { metric: UsageMetric; used: number; limit: number }[];
  documents: { used: number; limit: number };
  storage: { usedBytes: number; limitBytes: number };
}

/**
 * Billing and Usage's allowances (Section 5 row 14): each monthly metric for
 * the current entitlement period, with what a not-yet-created bucket would
 * carry over from an overlapping one, plus the file and storage gauges.
 */
export async function usageOverview(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<UsageOverview> {
  const { planCode, limits, period } = await currentEntitlement(db, userId, now);
  const start = period.start.toISOString();
  const rows = await db.execute<{ metric: string; used: string | number }>(sql`
    select m.metric,
      coalesce(
        (select b.reserved + b.consumed from usage_buckets b
          where b.user_id = ${userId} and b.metric = m.metric and b.period_start = ${start}::timestamptz),
        (select coalesce(sum(p.consumed), 0) from usage_buckets p
          where p.user_id = ${userId} and p.metric = m.metric
            and p.period_start < ${start}::timestamptz and p.period_end > ${start}::timestamptz)
      ) as used
    from unnest(${sql.raw(
      `array[${Object.keys(USAGE_METRICS)
        .map((metric) => `'${metric}'`)
        .join(", ")}]`,
    )}::text[]) as m(metric)`);
  const used = new Map(rows.map((row) => [row.metric, Number(row.used ?? 0)]));
  const [documents, storageBytes] = await Promise.all([
    ownedSourceCount(db, userId),
    storageBytesUsed(db, userId),
  ]);
  return {
    planCode,
    period,
    metrics: (Object.keys(USAGE_METRICS) as UsageMetric[]).map((metric) => ({
      metric,
      used: used.get(metric) ?? 0,
      limit: limits[USAGE_METRICS[metric]],
    })),
    documents: { used: documents, limit: limits.ownedSourcePdfs },
    storage: { usedBytes: storageBytes, limitBytes: limits.storageBytes },
  };
}
