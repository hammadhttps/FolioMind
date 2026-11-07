import {
  PROJECT_JOB_KINDS,
  readOutline,
  readProjectDoc,
  readProjectSettings,
  readProposals,
  type OutlineSection,
  type ProjectDoc,
  type ProjectMode,
  type ProjectSettings,
  type ProjectSourceView,
  type ProjectStatus,
  type ProjectTemplate,
  type SectionProposal,
} from "@foliomind/contracts";
import {
  documents,
  documentVersions,
  jobs,
  projects,
  projectSources,
  type Executor,
} from "@foliomind/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { readableSources, type Actor } from "../access";

/*
 * Reading a project (blueprint Sections 4 and 8). Ownership is checked here, so
 * an admin or another user simply finds nothing. Stored JSON is parsed on the
 * way out: a malformed value reads as empty, never as markup.
 */

export interface ProjectRecord {
  id: string;
  ownerId: string;
  workspaceId: string | null;
  title: string;
  mode: ProjectMode;
  prompt: string;
  settings: ProjectSettings;
  templateKey: ProjectTemplate;
  outline: OutlineSection[];
  content: ProjectDoc;
  revisionCounter: number;
  status: ProjectStatus;
  archivedAt: Date | null;
  firstDraftAt: Date | null;
  creditOperationKey: string | null;
  proposals: SectionProposal[];
  createdAt: Date;
  updatedAt: Date;
}

export function toProjectRecord(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    workspaceId: row.workspaceId,
    title: row.title,
    mode: row.mode,
    prompt: row.prompt,
    settings: readProjectSettings(row.settings),
    templateKey: row.templateKey as ProjectTemplate,
    outline: readOutline(row.outline),
    content: readProjectDoc(row.editorContent),
    revisionCounter: row.revisionCounter,
    status: row.status as ProjectStatus,
    archivedAt: row.archivedAt,
    firstDraftAt: row.firstDraftAt,
    creditOperationKey: row.creditOperationKey,
    proposals: readProposals(row.sectionProposals),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The actor's own project, or null for anyone else or once it's deleted. */
export async function getOwnedProject(
  db: Executor,
  actor: Actor,
  projectId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<ProjectRecord | null> {
  if (actor.status !== "active") return null;
  const query = db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.ownerId, actor.id), isNull(projects.deletedAt)),
    );
  const [row] = lock ? await query.for("update") : await query;
  return row ? toProjectRecord(row) : null;
}

/** The status a project rests at when no job is deciding it. */
export function settledStatus(project: {
  content: ProjectDoc;
  outline: readonly OutlineSection[];
}): ProjectStatus {
  const hasText = project.content.content.some(
    (node) =>
      node.type !== "paragraph" || (node.content ?? []).some((child) => child.type === "text"),
  );
  if (hasText) return "editing";
  return project.outline.length > 0 ? "outline" : "draft";
}

export async function liveProjectJob(
  db: Executor,
  projectId: string,
): Promise<{ id: string; kind: string } | null> {
  const [job] = await db
    .select({ id: jobs.id, kind: jobs.kind })
    .from(jobs)
    .where(
      and(
        eq(jobs.targetId, projectId),
        inArray(jobs.kind, [...PROJECT_JOB_KINDS]),
        inArray(jobs.status, ["queued", "running"]),
      ),
    );
  return job ?? null;
}

const UNAVAILABLE_TITLE = "A source that's no longer available";

/**
 * The project's pinned versions, with access checked again now. A source the
 * owner deleted keeps its title, so they can see which one to replace.
 */
export async function projectSourceStates(
  db: Executor,
  actor: Actor,
  projectId: string,
): Promise<ProjectSourceView[]> {
  const rows = await db
    .select({ versionId: projectSources.documentVersionId })
    .from(projectSources)
    .where(eq(projectSources.projectId, projectId))
    .orderBy(asc(projectSources.createdAt), asc(projectSources.documentVersionId));
  if (rows.length === 0) return [];
  const versionIds = rows.map((row) => row.versionId);
  const readable = new Map(
    (await readableSources(db, actor, versionIds)).map((source) => [source.versionId, source]),
  );
  const missing = versionIds.filter((versionId) => !readable.has(versionId));
  const own = new Map(
    missing.length === 0
      ? []
      : (
          await db
            .select({ versionId: documentVersions.id, title: documents.title })
            .from(documentVersions)
            .innerJoin(documents, eq(documents.id, documentVersions.documentId))
            .where(and(inArray(documentVersions.id, missing), eq(documents.ownerId, actor.id)))
        ).map((row) => [row.versionId, row.title]),
  );
  return versionIds.map((versionId) => {
    const source = readable.get(versionId);
    return source
      ? { versionId, title: source.title, available: source.status === "ready" }
      : { versionId, title: own.get(versionId) ?? UNAVAILABLE_TITLE, available: false };
  });
}

/** A readable, ready source in the shape retrieval takes. */
export interface UsableSource {
  versionId: string;
  documentId: string;
  title: string;
}

export type SourceCheck =
  { ok: true; sources: UsableSource[] } | { ok: false; code: "no_sources" | "source_unavailable" };

/** Research mode needs at least one source, all usable; general mode uses none. */
export async function checkProjectSources(
  db: Executor,
  actor: Actor,
  project: Pick<ProjectRecord, "id" | "mode">,
): Promise<SourceCheck> {
  if (project.mode === "general") return { ok: true, sources: [] };
  const states = await projectSourceStates(db, actor, project.id);
  if (states.length === 0) return { ok: false, code: "no_sources" };
  if (states.some((source) => !source.available)) return { ok: false, code: "source_unavailable" };
  const readable = new Map(
    (
      await readableSources(
        db,
        actor,
        states.map((source) => source.versionId),
      )
    ).map((source) => [source.versionId, source]),
  );
  return {
    ok: true,
    sources: states.flatMap((source) => {
      const found = readable.get(source.versionId);
      return found
        ? [{ versionId: source.versionId, documentId: found.documentId, title: found.title }]
        : [];
    }),
  };
}
