import { planLimitsSchema, type PlanCode, type PlanLimits } from "@foliomind/contracts";
import { plans, type Executor } from "@foliomind/db";
import { eq } from "drizzle-orm";

/*
 * Entitlements (blueprint Section 10). Free and Pro are billing entitlements,
 * not roles. Until Phase 10 synchronizes Stripe subscriptions, every user's
 * effective plan is Free.
 */

export async function effectivePlanCode(_db: Executor, _userId: string): Promise<PlanCode> {
  return "free";
}

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
  const planCode = await effectivePlanCode(db, userId);
  return { planCode, limits: await planLimits(db, planCode), period: freePeriod(now) };
}
