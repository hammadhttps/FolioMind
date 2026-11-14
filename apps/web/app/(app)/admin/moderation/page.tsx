import { MODERATION_PAGE_SIZE } from "@foliomind/contracts";
import { moderationSearchParamsSchema } from "@foliomind/contracts/search-params";
import { getSubmission, listReports, listSubmissions, moderationCounts } from "@foliomind/domain";
import type { Metadata } from "next";
import {
  ModerationScreen,
  type ModerationData,
} from "@/components/foliomind/admin/moderation-screen";
import { AdminAccessRequired } from "@/components/foliomind/screens/admin";
import { toReportRow, toSubmissionDetail, toSubmissionRow } from "@/lib/admin/view";
import { getDb } from "@/lib/clients";
import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Content moderation" };

/**
 * Content Moderation (Section 5 row 16). Admin only, decided on the server;
 * the Server Actions behind each decision check the role again from Postgres.
 */
export default async function ModerationPage({ searchParams }: PageProps<"/admin/moderation">) {
  const user = await requireSessionUser();
  if (!user.isAdmin) return <AdminAccessRequired />;
  const params = moderationSearchParamsSchema.parse(await searchParams);
  const db = getDb();
  const query = {
    status: params.status,
    q: params.q,
    after: params.after,
    before: params.before,
    limit: MODERATION_PAGE_SIZE,
  };
  const [counts, review, data] = await Promise.all([
    moderationCounts(db),
    params.review ? getSubmission(db, params.review) : null,
    params.type === "report"
      ? listReports(db, query).then((page): ModerationData => ({
          type: "report",
          page: { ...page, items: page.items.map(toReportRow) },
        }))
      : listSubmissions(db, query).then((page): ModerationData => ({
          type: "submission",
          page: { ...page, items: page.items.map(toSubmissionRow) },
        })),
  ]);
  return (
    <ModerationScreen
      data={data}
      counts={counts}
      review={review ? toSubmissionDetail(review) : null}
    />
  );
}
