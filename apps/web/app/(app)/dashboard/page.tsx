import { WORKSPACE_PAGE_SIZE } from "@foliomind/contracts";
import { workspaceSearchParamsSchema } from "@foliomind/contracts/search-params";
import {
  continueReading,
  dashboardCounts,
  listWorkspaces,
  uploadAllowance,
} from "@foliomind/domain";
import type { Metadata } from "next";
import { DashboardScreen } from "@/components/foliomind/screens/dashboard";
import { getDb } from "@/lib/clients";
import { requireUser } from "@/lib/session";
import { toWorkspaceCard } from "@/lib/workspaces/view";

export const metadata: Metadata = { title: "Dashboard" };

/** Real counts and recent reading only (Section 20 #6: no sample figures). */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const params = workspaceSearchParamsSchema.parse(await searchParams);
  const db = getDb();
  const [counts, reading, allowance, workspaces] = await Promise.all([
    dashboardCounts(db, user.id),
    continueReading(db, user.id, 3),
    uploadAllowance(db, user.id),
    listWorkspaces(db, {
      userId: user.id,
      q: params.q,
      sort: params.sort,
      limit: WORKSPACE_PAGE_SIZE,
    }),
  ]);
  // The rail always shows recent work, whatever the research tab is filtered to.
  const recent =
    !params.q && params.sort === "updated"
      ? workspaces.items.slice(0, 3)
      : (await listWorkspaces(db, { userId: user.id, sort: "updated", limit: 3 })).items;
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
        workspaces: {
          items: workspaces.items.map(toWorkspaceCard),
          nextCursor: workspaces.nextCursor,
        },
        recentWorkspaces: recent.map(toWorkspaceCard),
      }}
    />
  );
}
