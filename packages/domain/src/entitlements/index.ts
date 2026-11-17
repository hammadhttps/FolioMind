import {
  PAID_ACCESS_STATUSES,
  planLimitsSchema,
  type PlanCode,
  type PlanLimits,
} from "@foliomind/contracts";
import { plans, subscriptions, type Executor } from "@foliomind/db";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

/*
 * Entitlements (blueprint Section 10 "Access rules and usage"). Free and Pro
 * are billing entitlements, not roles. Pro holds only while the server-side
 * snapshot synchronized from Stripe shows a Pro subscription that is active,
 * trialing or past due AND paid through a time still ahead: incomplete,
 * incomplete_expired, canceled, unpaid and paused never start or keep access,
 * cancel-at-period-end keeps what was paid for, and a failed renewal keeps
 * access only until the paid-through time (no extra grace). A later payment
 * extends paid-through and restores Pro.
 */

export interface ProAccess {
  periodStart: Date;
  periodEnd: Date;
  paidThrough: Date;
}

/** The subscription giving the user Pro right now, or null. */
export async function activeProAccess(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<ProAccess | null> {
  const [row] = await db
    .select({
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      paidThrough: subscriptions.paidThrough,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.planCode, "pro"),
        inArray(subscriptions.status, [...PAID_ACCESS_STATUSES]),
        gt(subscriptions.paidThrough, now),
      ),
    )
    .orderBy(desc(subscriptions.paidThrough))
    .limit(1);
  if (!row?.paidThrough) return null;
  return { periodStart: row.periodStart, periodEnd: row.periodEnd, paidThrough: row.paidThrough };
}

export async function effectivePlanCode(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<PlanCode> {
  return (await activeProAccess(db, userId, now)) ? "pro" : "free";
}

/**
 * The effective plan as SQL for lists (admin users), the same rule as
 * `activeProAccess`; `userId` is the column holding the user's ID.
 */
export const effectivePlanSql = (userId: unknown) => sql`case when exists (
  select 1 from subscriptions s
  where s.user_id = ${userId} and s.plan_code = 'pro'
    and s.status in (${sql.join(
      PAID_ACCESS_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )})
    and s.paid_through > now()
) then 'pro' else 'free' end`;

export class PlanNotFoundError extends Error {
  constructor(code: string) {
    super(`Plan ${code} is missing or disabled; run \`pnpm db:seed\``);
    this.name = "PlanNotFoundError";
  }
}

/** Limits from the `plans` row, parsed against the versioned schema. */
export async function planLimits(db: Executor, code: PlanCode): Promise<PlanLimits> {
  const [row] = await db
    .select({ limits: plans.limits, enabled: plans.enabled })
    .from(plans)
    .where(eq(plans.code, code));
  if (!row || !row.enabled) throw new PlanNotFoundError(code);
  return planLimitsSchema.parse(row.limits);
}

/** Free periods are UTC calendar months (Section 10). */
export function freePeriod(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Pro periods follow Stripe's billing period. If the snapshot is a little
 * behind a renewal (`now` past the stored period end while still paid), the
 * period rolls forward by whole lengths so usage still lands in the right
 * bucket until the next sync stores the new one.
 */
export function proPeriod(now: Date, access: ProAccess): { start: Date; end: Date } {
  const start = access.periodStart.getTime();
  const length = Math.max(1, access.periodEnd.getTime() - start);
  const steps = now.getTime() < start ? 0 : Math.floor((now.getTime() - start) / length);
  return { start: new Date(start + steps * length), end: new Date(start + (steps + 1) * length) };
}

export interface Entitlement {
  planCode: PlanCode;
  limits: PlanLimits;
  period: { start: Date; end: Date };
}

/** The plan, its limits and the allowance period that applies right now. */
export async function currentEntitlement(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<Entitlement> {
  const access = await activeProAccess(db, userId, now);
  const planCode: PlanCode = access ? "pro" : "free";
  return {
    planCode,
    limits: await planLimits(db, planCode),
    period: access ? proPeriod(now, access) : freePeriod(now),
  };
}
