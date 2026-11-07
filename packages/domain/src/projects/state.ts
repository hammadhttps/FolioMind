import { PROJECT_JOB_KINDS, type StudioState } from "@foliomind/contracts";
import { jobs, type Executor } from "@foliomind/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Actor } from "../access";
import { jobStatusForOwner } from "../jobs";
import { listProjectRevisions } from "./content";
import { listProjectExports } from "./exports";
import { draftCharge, outlineCharge, projectAllowance } from "./generation";
import { getOwnedProject, projectSourceStates } from "./records";

/*
 * Everything PDF Studio shows, in one read: the page's first render and the poll
 * while a job runs. The document is left out when the client already has this
 * `revision_counter`, because it is by far the largest part.
 */

export async function getStudioState(
  db: Executor,
  actor: Actor,
  projectId: string,
  { knownCounter }: { knownCounter?: number | undefined } = {},
): Promise<StudioState | null> {
  const project = await getOwnedProject(db, actor, projectId);
  if (!project) return null;
  const [latestJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.targetId, projectId), inArray(jobs.kind, [...PROJECT_JOB_KINDS])))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(1);
  const [sources, revisions, exports, allowance, job] = await Promise.all([
    projectSourceStates(db, actor, projectId),
    listProjectRevisions(db, projectId),
    listProjectExports(db, projectId),
    projectAllowance(db, actor.id),
    latestJob ? jobStatusForOwner(db, actor.id, latestJob.id) : null,
  ]);
  return {
    id: project.id,
    title: project.title,
    mode: project.mode,
    status: project.status,
    prompt: project.prompt,
    settings: project.settings,
    template: project.templateKey,
    outline: project.outline,
    revisionCounter: project.revisionCounter,
    content: knownCounter === project.revisionCounter ? null : project.content,
    archived: project.archivedAt !== null,
    firstDraftDone: project.firstDraftAt !== null,
    sources,
    proposals: project.proposals,
    job,
    revisions,
    exports,
    allowance,
    charges: { outline: outlineCharge(project), draft: draftCharge(project) },
  };
}
