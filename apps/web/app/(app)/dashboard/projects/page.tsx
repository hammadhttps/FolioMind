import { PROJECTS_PAGE_SIZE } from "@foliomind/contracts";
import { projectsSearchParamsSchema } from "@foliomind/contracts/search-params";
import { listProjects } from "@foliomind/domain";
import type { Metadata } from "next";
import { MyProjectsScreen } from "@/components/foliomind/screens/my-projects";
import { getDb } from "@/lib/clients";
import { toProjectRow } from "@/lib/projects/view";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My Projects" };

/** My Projects (Section 24): the owner's rows, then the URL's filters, then keyset paging. */
export default async function MyProjectsPage({ searchParams }: PageProps<"/dashboard/projects">) {
  const user = await requireUser();
  const params = projectsSearchParamsSchema.parse(await searchParams);
  const page = await listProjects(getDb(), {
    userId: user.id,
    q: params.q,
    status: params.status,
    mode: params.mode,
    template: params.template,
    archived: params.archived === "archived",
    sort: params.sort,
    after: params.after,
    before: params.before,
    limit: PROJECTS_PAGE_SIZE,
  });
  return (
    <MyProjectsScreen
      page={{
        items: page.items.map(toProjectRow),
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
        pageSize: PROJECTS_PAGE_SIZE,
      }}
    />
  );
}
