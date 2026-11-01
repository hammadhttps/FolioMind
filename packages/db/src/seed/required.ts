import { PLAN_LIMITS } from "@foliomind/contracts";
import { STARTER_CATEGORIES } from "@foliomind/contracts/search-params";
import { sql } from "drizzle-orm";
import type { Database } from "../client";
import { categories, plans } from "../schema";

/**
 * Rows every environment needs (blueprint Section 10): the Free and Pro plans
 * with their versioned limits, and the starter catalog categories. Idempotent;
 * re-running updates plan limits, while Pro's Stripe price stays unset until
 * Phase 10 configures it.
 */
export async function seedRequired(db: Database): Promise<{ plans: number; categories: number }> {
  return db.transaction(async (tx) => {
    const planRows = await tx
      .insert(plans)
      .values([
        { code: "free", limits: PLAN_LIMITS.free, enabled: true },
        { code: "pro", limits: PLAN_LIMITS.pro, enabled: true },
      ])
      .onConflictDoUpdate({
        target: plans.code,
        set: { limits: sql`excluded.limits`, updatedAt: sql`now()` },
      })
      .returning({ code: plans.code });

    const categoryRows = await tx
      .insert(categories)
      .values(STARTER_CATEGORIES.map(({ slug, name }) => ({ slug, name })))
      .onConflictDoNothing({ target: categories.slug })
      .returning({ id: categories.id });

    return { plans: planRows.length, categories: categoryRows.length };
  });
}
