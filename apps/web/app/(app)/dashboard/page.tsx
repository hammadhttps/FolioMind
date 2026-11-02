import { continueReading, dashboardCounts, uploadAllowance } from "@foliomind/domain";
import type { Metadata } from "next";
import { DashboardScreen } from "@/components/foliomind/screens/dashboard";
import { getDb } from "@/lib/clients";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

/** Real counts and recent reading only (Section 20 #6: no sample figures). */
export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();
  const [counts, reading, allowance] = await Promise.all([
    dashboardCounts(db, user.id),
    continueReading(db, user.id, 3),
    uploadAllowance(db, user.id),
  ]);
  return (
    <DashboardScreen
      data={{
        counts,
        continueReading: reading.map(({ documentId, title, pageNumber, pageCount }) => ({
          documentId,
          title,
          pageNumber,
          pageCount,
        })),
        allowance,
      }}
    />
  );
}
