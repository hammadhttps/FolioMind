import { billingSnapshot, usageOverview } from "@foliomind/domain";
import type { Metadata } from "next";
import { BillingScreen } from "@/components/foliomind/screens/billing";
import { billingConfigured, isSandbox } from "@/lib/billing/server";
import { getDb } from "@/lib/clients";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Billing and usage" };

/**
 * Billing and Usage (Section 5 row 14), from the server's own snapshot. The
 * `?checkout=returned` flag only shows Payment pending; Pro comes from the
 * webhook sync, never from this URL.
 */
export default async function BillingPage({ searchParams }: PageProps<"/dashboard/billing">) {
  const user = await requireUser();
  const db = getDb();
  const [snapshot, usage, params] = await Promise.all([
    billingSnapshot(db, user.id),
    usageOverview(db, user.id),
    searchParams,
  ]);
  return (
    <BillingScreen
      data={{
        snapshot,
        usage: {
          periodStart: usage.period.start.toISOString(),
          periodEnd: usage.period.end.toISOString(),
          metrics: usage.metrics,
          documents: usage.documents,
          storage: usage.storage,
        },
        configured: billingConfigured(),
        sandbox: isSandbox(),
        returned: params.checkout === "returned",
      }}
    />
  );
}
