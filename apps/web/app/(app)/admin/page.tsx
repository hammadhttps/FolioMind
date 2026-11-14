import { ADMIN_PAGE_SIZE, AUDIT_PAGE_SIZE } from "@foliomind/contracts";
import { adminSearchParamsSchema } from "@foliomind/contracts/search-params";
import {
  adminOverviewCounts,
  healthSummary,
  listAdminJobs,
  listAdminUsers,
  listAuditLog,
  listPublisherApplications,
  usageReport,
} from "@foliomind/domain";
import type { Metadata } from "next";
import { AdminOverviewScreen, type AdminData } from "@/components/foliomind/admin/admin-overview";
import { AdminAccessRequired } from "@/components/foliomind/screens/admin";
import { toAdminJobRow, toAdminUserRow, toApplicationRow, toAuditRow } from "@/lib/admin/view";
import { getDb } from "@/lib/clients";
import { requireSessionUser } from "@/lib/session";

export const metadata: Metadata = { title: "Admin" };

const iso = (value: Date | null) => value?.toISOString() ?? null;

/*
 * Admin Overview (Section 5 row 15). Checked on the server, because hidden
 * navigation is not security (Section 4); each tab loads only its own page of
 * rows, and every mutation re-reads the admin from Postgres.
 */
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const user = await requireSessionUser();
  if (!user.isAdmin) return <AdminAccessRequired />;
  const params = adminSearchParamsSchema.parse(await searchParams);
  const db = getDb();
  const page = { after: params.after, before: params.before };

  let data: AdminData;
  if (params.tab === "users") {
    const users = await listAdminUsers(db, {
      q: params.q,
      role: params.role,
      status: params.status,
      plan: params.plan,
      ...page,
      limit: ADMIN_PAGE_SIZE,
    });
    data = {
      tab: "users",
      users: { ...users, items: users.items.map(toAdminUserRow) },
      selfId: user.id,
    };
  } else if (params.tab === "applications") {
    const decided = params.status === "decided";
    const applications = await listPublisherApplications(db, {
      status: decided ? "decided" : "applicant",
      q: params.q,
      ...page,
      limit: ADMIN_PAGE_SIZE,
    });
    data = {
      tab: "applications",
      decided,
      applications: { ...applications, items: applications.items.map(toApplicationRow) },
    };
  } else if (params.tab === "usage") {
    data = {
      tab: "usage",
      usage: await usageReport(db, { rangeDays: Number(params.range), before: params.before }),
    };
  } else if (params.tab === "audit") {
    const audit = await listAuditLog(db, {
      q: params.q,
      action: params.action,
      from: params.from,
      to: params.to,
      ...page,
      limit: AUDIT_PAGE_SIZE,
    });
    data = { tab: "audit", audit: { ...audit, items: audit.items.map(toAuditRow) } };
  } else {
    const [health, jobs] = await Promise.all([
      healthSummary(db),
      listAdminJobs(db, {
        q: params.q,
        kind: params.kind,
        status: params.status,
        from: params.from,
        to: params.to,
        ...page,
        limit: ADMIN_PAGE_SIZE,
      }),
    ]);
    data = {
      tab: "health",
      health: {
        ...health,
        oldestQueuedAt: iso(health.oldestQueuedAt),
        outbox: { ...health.outbox, oldestAt: iso(health.outbox.oldestAt) },
        webhooks: { ...health.webhooks, oldestAt: iso(health.webhooks.oldestAt) },
      },
      jobs: { ...jobs, items: jobs.items.map(toAdminJobRow) },
    };
  }
  return <AdminOverviewScreen counts={await adminOverviewCounts(db)} data={data} />;
}
