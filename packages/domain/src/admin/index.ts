import {
  ADMIN_RETRYABLE_JOB_KINDS,
  SUSPENSION_MAX_DAYS,
  type AdminRefusalCode,
} from "@foliomind/contracts";
import {
  exports as projectExports,
  jobs,
  projectRevisions,
  users,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, sql } from "drizzle-orm";
import type { Actor } from "../access";
import { writeAudit } from "../audit";
import { canRetryJob } from "../jobs";
import { keysetPage, keysetPlan, likePattern, type KeysetPage } from "../keyset";
import { retryDocument } from "../processing";
import { requestProjectExport } from "../projects";

/*
 * Admin Overview (blueprint Sections 4, 5 row 15, 23 and 24). Operational
 * views show IDs, kinds, statuses, safe error codes, counts and costs only:
 * never prompts, document text or private files. Every mutation is audited.
 */

/* --- Health ---------------------------------------------------------------- */

export interface HealthSummary {
  /** Jobs created in the last 7 days, by kind and status. */
  jobCounts: { kind: string; status: string; count: number }[];
  oldestQueuedAt: Date | null;
  failedLast24h: number;
  outbox: { pending: number; oldestAt: Date | null };
  webhooks: { backlog: number; oldestAt: Date | null };
}

export async function healthSummary(db: Executor, now: Date = new Date()): Promise<HealthSummary> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [counts, [summary]] = await Promise.all([
    db.execute<{ kind: string; status: string; count: number }>(sql`
      select kind, status, count(*)::int as count from jobs
      where created_at >= ${weekAgo}::timestamptz
      group by kind, status order by kind, status`),
    db.execute<{
      oldest_queued: string | null;
      failed: number;
      outbox_pending: number;
      outbox_oldest: string | null;
      webhook_backlog: number;
      webhook_oldest: string | null;
    }>(sql`
      select
        (select min(created_at) from jobs where status = 'queued') as oldest_queued,
        (select count(*)::int from jobs where status = 'failed'
          and updated_at >= ${dayAgo}::timestamptz) as failed,
        (select count(*)::int from outbox_events where delivered_at is null) as outbox_pending,
        (select min(available_at) from outbox_events where delivered_at is null) as outbox_oldest,
        (select count(*)::int from webhook_events where status <> 'processed') as webhook_backlog,
        (select min(received_at) from webhook_events where status <> 'processed') as webhook_oldest`),
  ]);
  const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);
  return {
    jobCounts: counts.map((row) => ({ ...row, count: Number(row.count) })),
    oldestQueuedAt: toDate(summary?.oldest_queued),
    failedLast24h: Number(summary?.failed ?? 0),
    outbox: {
      pending: Number(summary?.outbox_pending ?? 0),
      oldestAt: toDate(summary?.outbox_oldest),
    },
    webhooks: {
      backlog: Number(summary?.webhook_backlog ?? 0),
      oldestAt: toDate(summary?.webhook_oldest),
    },
  };
}

export interface AdminJobRow {
  id: string;
  kind: string;
  status: string;
  phase: string;
  safeErrorCode: string | null;
  attempts: number;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  canRetry: boolean;
}

/** Admin jobs (Section 24): job ID or owner email, kind, status, date range, newest first. */
export async function listAdminJobs(
  db: Executor,
  query: {
    q?: string | undefined;
    kind?: string | undefined;
    status?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<AdminJobRow>> {
  const plan = keysetPlan({
    sortKey: sql`j.created_at`,
    idColumn: sql`j.id`,
    ascending: false,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [sql`true`];
  if (query.q) {
    filters.push(
      /^[0-9a-f-]{36}$/i.test(query.q)
        ? sql`j.id = ${query.q}::uuid`
        : sql`u.email ilike ${likePattern(query.q)}`,
    );
  }
  if (query.kind && query.kind !== "all") filters.push(sql`j.kind = ${query.kind}`);
  if (query.status && query.status !== "all") filters.push(sql`j.status = ${query.status}`);
  if (query.from) filters.push(sql`j.created_at >= ${query.from}::date`);
  if (query.to) filters.push(sql`j.created_at < (${query.to}::date + 1)`);
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    kind: string;
    status: string;
    phase: string;
    safe_error_code: string | null;
    attempts: number;
    owner_email: string | null;
    created_at: string;
    updated_at: string;
    sort_value: string;
  }>(sql`
    select j.id, j.kind, j.status, j.phase, j.safe_error_code, j.attempts, u.email as owner_email,
      j.created_at, j.updated_at, j.created_at::text as sort_value
    from jobs j left join users u on u.id = j.owner_id
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    safeErrorCode: row.safe_error_code,
    attempts: Number(row.attempts),
    ownerEmail: row.owner_email,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    canRetry:
      (ADMIN_RETRYABLE_JOB_KINDS as readonly string[]).includes(row.kind) &&
      canRetryJob({ status: row.status, safeErrorCode: row.safe_error_code }),
  }));
}

export type AdminRetryOutcome =
  | { ok: true; jobId: string; eventKeys: string[] }
  | {
      ok: false;
      code: Extract<AdminRefusalCode, "not_found" | "not_retryable" | "quota" | "busy">;
    };

/**
 * Retry a failed job (Section 5 row 15) through the same path its owner's
 * Retry uses, with a new job and operation key. Usage is charged by the same
 * rules (a failure released its reservation, so nothing is charged twice),
 * ingestion notices are unique per version and exports per export, so a retry
 * never duplicates credits, exports or notifications. Generation jobs are
 * retried by their owner from PDF Studio, where the text they'd change is.
 */
export async function retryJobAsAdmin(
  db: Database,
  admin: Actor,
  jobId: string,
): Promise<AdminRetryOutcome> {
  const [job] = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      safeErrorCode: jobs.safeErrorCode,
      ownerId: jobs.ownerId,
      targetId: jobs.targetId,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!job || !job.ownerId || !job.targetId) return { ok: false, code: "not_found" };
  if (!(ADMIN_RETRYABLE_JOB_KINDS as readonly string[]).includes(job.kind) || !canRetryJob(job)) {
    return { ok: false, code: "not_retryable" };
  }
  const [owner] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, job.ownerId));
  if (!owner || owner.status !== "active") return { ok: false, code: "not_retryable" };

  let result: AdminRetryOutcome;
  if (job.kind === "render-export") {
    const [target] = await db
      .select({
        revisionId: projectExports.projectRevisionId,
        projectId: projectRevisions.projectId,
      })
      .from(projectExports)
      .innerJoin(projectRevisions, eq(projectRevisions.id, projectExports.projectRevisionId))
      .where(and(eq(projectExports.jobId, job.id), eq(projectRevisions.projectId, job.targetId)));
    if (!target) return { ok: false, code: "not_found" };
    const outcome = await requestProjectExport(db, owner, target.projectId, target.revisionId);
    if (!outcome.ok) {
      result = {
        ok: false,
        code:
          outcome.code === "busy"
            ? "busy"
            : outcome.code === "quota_reexports" || outcome.code === "storage_limit"
              ? "quota"
              : "not_retryable",
      };
    } else if ("reused" in outcome && outcome.reused) {
      result = { ok: false, code: "not_retryable" };
    } else {
      result = { ok: true, jobId: outcome.jobId, eventKeys: [outcome.eventKey] };
    }
  } else {
    const documentId =
      job.kind === "import-url"
        ? job.targetId
        : (
            await db.execute<{ document_id: string }>(
              sql`select document_id from document_versions where id = ${job.targetId}`,
            )
          )[0]?.document_id;
    if (!documentId) return { ok: false, code: "not_found" };
    const outcome = await retryDocument(db, { userId: owner.id, documentId });
    if (!outcome.ok) {
      result = {
        ok: false,
        code:
          outcome.code === "not_found" || outcome.code === "not_retryable" ? outcome.code : "quota",
      };
    } else {
      result = { ok: true, jobId: outcome.jobId, eventKeys: [outcome.eventKey] };
    }
  }
  if (result.ok) {
    await writeAudit(db, {
      actorId: admin.id,
      action: "job.retried",
      targetType: "job",
      targetId: job.id,
      metadata: { kind: job.kind, newJobId: result.jobId, ownerId: owner.id },
    });
  }
  return result;
}

/* --- Users and suspension -------------------------------------------------- */

export interface AdminUserRow {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  role: "reader" | "publisher" | "admin";
  status: "active" | "suspended" | "deleting";
  plan: "free" | "pro";
  suspendedUntil: Date | null;
  createdAt: Date;
}

/**
 * The effective plan as SQL, matching `effectivePlanCode` (Free until Phase 10
 * synchronizes Stripe; replace both together).
 */
const PLAN_SQL = sql`'free'`;

/** Admin users (Section 24): email or name, role, status and plan, newest first. */
export async function listAdminUsers(
  db: Executor,
  query: {
    q?: string | undefined;
    role?: string | undefined;
    status?: string | undefined;
    plan?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<AdminUserRow>> {
  const plan = keysetPlan({
    sortKey: sql`u.created_at`,
    idColumn: sql`u.id`,
    ascending: false,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [sql`u.deleted_at is null`];
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(sql`(u.email ilike ${pattern} or u.display_name ilike ${pattern})`);
  }
  if (query.role && query.role !== "all") filters.push(sql`u.role = ${query.role}::user_role`);
  if (query.status && query.status !== "all") {
    filters.push(sql`u.status = ${query.status}::user_status`);
  }
  if (query.plan && query.plan !== "all") filters.push(sql`${PLAN_SQL} = ${query.plan}`);
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    email: string;
    email_verified: boolean;
    display_name: string;
    role: AdminUserRow["role"];
    status: AdminUserRow["status"];
    plan: AdminUserRow["plan"];
    suspended_until: string | null;
    created_at: string;
    sort_value: string;
  }>(sql`
    select u.id, u.email, u.email_verified, u.display_name, u.role, u.status, ${PLAN_SQL} as plan,
      u.suspended_until, u.created_at, u.created_at::text as sort_value
    from users u
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    plan: row.plan,
    suspendedUntil: row.suspended_until ? new Date(row.suspended_until) : null,
    createdAt: new Date(row.created_at),
  }));
}

export type SuspensionOutcome =
  | { ok: true; userId: string }
  | {
      ok: false;
      code: Extract<
        AdminRefusalCode,
        | "not_found"
        | "self"
        | "admin_target"
        | "already_suspended"
        | "not_suspended"
        | "deleting"
        | "end_in_past"
        | "end_too_far"
      >;
    };

/**
 * Suspend a user (Section 28 "Suspend user"). Takes effect at once: the caller
 * deletes the user's cached snapshot and every request re-checks the status.
 * Admin accounts aren't suspended here (they're managed by the audited
 * privileged process), and nobody suspends themselves.
 */
export async function suspendUser(
  db: Database,
  admin: Actor,
  input: { userId: string; reason: string; endsOn?: string | undefined },
  now: Date = new Date(),
): Promise<SuspensionOutcome> {
  if (input.userId === admin.id) return { ok: false, code: "self" };
  let until: Date | null = null;
  if (input.endsOn) {
    until = new Date(`${input.endsOn}T00:00:00.000Z`);
    if (until.getTime() <= now.getTime()) return { ok: false, code: "end_in_past" };
    if (until.getTime() - now.getTime() > SUSPENSION_MAX_DAYS * 24 * 60 * 60 * 1000) {
      return { ok: false, code: "end_too_far" };
    }
  }
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, role: users.role, status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!target || target.deletedAt) return { ok: false, code: "not_found" } as const;
    if (target.role === "admin") return { ok: false, code: "admin_target" } as const;
    if (target.status === "deleting") return { ok: false, code: "deleting" } as const;
    if (target.status === "suspended") return { ok: false, code: "already_suspended" } as const;
    await tx
      .update(users)
      .set({ status: "suspended", suspendedUntil: until, updatedAt: sql`now()` })
      .where(eq(users.id, target.id));
    await writeAudit(tx, {
      actorId: admin.id,
      action: "user.suspended",
      targetType: "user",
      targetId: target.id,
      metadata: {
        reason: input.reason.slice(0, 200),
        endsOn: input.endsOn ?? null,
      },
    });
    return { ok: true, userId: target.id } as const;
  });
}

export async function unsuspendUser(
  db: Database,
  admin: Actor,
  input: { userId: string; reason?: string | undefined },
): Promise<SuspensionOutcome> {
  if (input.userId === admin.id) return { ok: false, code: "self" };
  return db.transaction(async (tx) => {
    const lifted = await tx
      .update(users)
      .set({ status: "active", suspendedUntil: null, updatedAt: sql`now()` })
      .where(and(eq(users.id, input.userId), eq(users.status, "suspended")))
      .returning({ id: users.id });
    if (lifted.length === 0) return { ok: false, code: "not_suspended" } as const;
    await writeAudit(tx, {
      actorId: admin.id,
      action: "user.unsuspended",
      targetType: "user",
      targetId: input.userId,
      metadata: { reason: input.reason?.slice(0, 200) ?? null },
    });
    return { ok: true, userId: input.userId } as const;
  });
}

/* --- Usage and cost -------------------------------------------------------- */

export interface UsageDay {
  date: string;
  purposes: {
    purpose: string;
    runs: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  }[];
}

export interface UsageReport {
  days: UsageDay[];
  totals: { runs: number; inputTokens: number; outputTokens: number; estimatedCost: number };
  /** This UTC month's allowances across all users: reserved and consumed per metric. */
  allowances: { metric: string; users: number; consumed: number; reserved: number }[];
  /** Pass as `before` for older days. */
  olderCursor: string | null;
}

const USAGE_DAYS_PER_PAGE = 10;

/**
 * Aggregates from `ai_runs` by UTC day and purpose, and this month's usage
 * buckets: tokens, run counts and estimated cost only (Section 5 row 15).
 */
export async function usageReport(
  db: Executor,
  query: { rangeDays: number; before?: string | undefined; now?: Date },
): Promise<UsageReport> {
  const now = query.now ?? new Date();
  const since = new Date(now.getTime() - (query.rangeDays - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const before = query.before && /^\d{4}-\d{2}-\d{2}$/.test(query.before) ? query.before : null;
  const dayRows = await db.execute<{ day: string }>(sql`
    select distinct (created_at at time zone 'UTC')::date::text as day from ai_runs
    where created_at >= ${since}::date
      ${before ? sql`and (created_at at time zone 'UTC')::date < ${before}::date` : sql``}
    order by day desc limit ${USAGE_DAYS_PER_PAGE + 1}`);
  const pageDays = dayRows.slice(0, USAGE_DAYS_PER_PAGE).map((row) => row.day);
  const rows =
    pageDays.length === 0
      ? []
      : await db.execute<{
          day: string;
          purpose: string;
          runs: number;
          failed: number;
          input_tokens: string;
          output_tokens: string;
          cost: string | null;
        }>(sql`
          select (created_at at time zone 'UTC')::date::text as day, purpose,
            count(*)::int as runs, count(*) filter (where status <> 'succeeded')::int as failed,
            coalesce(sum(input_tokens), 0)::bigint as input_tokens,
            coalesce(sum(output_tokens), 0)::bigint as output_tokens,
            coalesce(sum(estimated_cost), 0)::numeric(14, 6)::text as cost
          from ai_runs
          where (created_at at time zone 'UTC')::date in (${sql.join(
            pageDays.map((day) => sql`${day}::date`),
            sql`, `,
          )})
          group by 1, 2 order by 1 desc, 2`);
  const [totals] = await db.execute<{
    runs: number;
    input_tokens: string;
    output_tokens: string;
    cost: string | null;
  }>(sql`
    select count(*)::int as runs, coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(estimated_cost), 0)::numeric(14, 6)::text as cost
    from ai_runs where created_at >= ${since}::date`);
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const allowances = await db.execute<{
    metric: string;
    users: number;
    consumed: string;
    reserved: string;
  }>(sql`
    select metric, count(distinct user_id)::int as users,
      coalesce(sum(consumed), 0)::bigint as consumed, coalesce(sum(reserved), 0)::bigint as reserved
    from usage_buckets where period_start >= ${monthStart}::date
    group by metric order by metric`);

  const days = pageDays.map((day) => ({
    date: day,
    purposes: rows
      .filter((row) => row.day === day)
      .map((row) => ({
        purpose: row.purpose,
        runs: Number(row.runs),
        failed: Number(row.failed),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
        estimatedCost: Number(row.cost ?? 0),
      })),
  }));
  return {
    days,
    totals: {
      runs: Number(totals?.runs ?? 0),
      inputTokens: Number(totals?.input_tokens ?? 0),
      outputTokens: Number(totals?.output_tokens ?? 0),
      estimatedCost: Number(totals?.cost ?? 0),
    },
    allowances: allowances.map((row) => ({
      metric: row.metric,
      users: Number(row.users),
      consumed: Number(row.consumed),
      reserved: Number(row.reserved),
    })),
    olderCursor: dayRows.length > USAGE_DAYS_PER_PAGE ? (pageDays.at(-1) ?? null) : null,
  };
}

/* --- Audit log ------------------------------------------------------------- */

export interface AuditRow {
  id: string;
  createdAt: Date;
  action: string;
  actorEmail: string | null;
  actorId: string | null;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

/** Admin audit log (Section 24): actor or target, action, date range, newest first, 50 a page. */
export async function listAuditLog(
  db: Executor,
  query: {
    q?: string | undefined;
    action?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<AuditRow>> {
  const plan = keysetPlan({
    sortKey: sql`a.created_at`,
    idColumn: sql`a.id`,
    ascending: false,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [sql`true`];
  if (query.q) {
    filters.push(
      /^[0-9a-f-]{36}$/i.test(query.q)
        ? sql`(a.target_id = ${query.q} or a.actor_id = ${query.q}::uuid)`
        : sql`(u.email ilike ${likePattern(query.q)} or a.target_id ilike ${likePattern(query.q)})`,
    );
  }
  if (query.action) filters.push(sql`a.action = ${query.action}`);
  if (query.from) filters.push(sql`a.created_at >= ${query.from}::date`);
  if (query.to) filters.push(sql`a.created_at < (${query.to}::date + 1)`);
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    created_at: string;
    action: string;
    actor_id: string | null;
    actor_email: string | null;
    target_type: string;
    target_id: string;
    safe_metadata: Record<string, unknown>;
    sort_value: string;
  }>(sql`
    select a.id, a.created_at, a.action, a.actor_id, u.email as actor_email, a.target_type,
      a.target_id, a.safe_metadata, a.created_at::text as sort_value
    from audit_logs a left join users u on u.id = a.actor_id
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    createdAt: new Date(row.created_at),
    action: row.action,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.safe_metadata,
  }));
}

/** The four overview metrics (Section 20 #15), from real counts. */
export async function adminOverviewCounts(db: Executor) {
  const [row] = await db.execute<{
    accounts: number;
    documents: number;
    pending_reviews: number;
    failed_jobs: number;
  }>(sql`
    select
      (select count(*)::int from users where deleted_at is null) as accounts,
      (select count(*)::int from documents where status = 'active' and deleted_at is null) as documents,
      (select count(*)::int from book_revisions br join books b on b.id = br.book_id
        where br.status = 'pending' and b.deleted_at is null)
        + (select count(*)::int from content_reports where status = 'open')
        + (select count(*)::int from publisher_profiles where status = 'applicant') as pending_reviews,
      (select count(*)::int from jobs where status = 'failed'
        and updated_at >= now() - interval '24 hours') as failed_jobs`);
  return {
    accounts: Number(row?.accounts ?? 0),
    documents: Number(row?.documents ?? 0),
    pendingReviews: Number(row?.pending_reviews ?? 0),
    failedJobs: Number(row?.failed_jobs ?? 0),
  };
}
