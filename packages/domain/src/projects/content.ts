import {
  docHasText,
  docReferences,
  EMPTY_PROJECT_DOC,
  readProjectDoc,
  renumberCitations,
  sectionNodes,
  upsertDocSection,
  type ProjectDoc,
  type ProjectRevisionView,
  type ProjectStatus,
  type RevisionSource,
} from "@foliomind/contracts";
import {
  documents,
  documentVersions,
  projectRevisions,
  projects,
  projectSources,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { readableSources, type Actor } from "../access";
import { getOwnedProject, liveProjectJob, type ProjectRecord } from "./records";

/*
 * What the owner wrote (blueprint Sections 5, 8 and 11). Saves use optimistic
 * concurrency on `revision_counter`, so a second tab can't overwrite the first.
 * Revisions are immutable rows, and anything that replaces the owner's text
 * saves a revision of it first, so nothing is lost silently.
 */

/** After the owner edits, the project is being edited again, whatever it was before. */
const editingStatusSql = sql`case when ${projects.status} in ('draft', 'outline', 'complete', 'failed') then 'editing' else ${projects.status} end`;

export type SaveContentOutcome =
  | { ok: true; counter: number }
  | { ok: false; code: "conflict"; counter: number }
  | { ok: false; code: "not_found" | "archived" | "busy" };

/** Autosave. A stale `baseCounter` changes nothing and reports the conflict. */
export async function saveProjectContent(
  db: Executor,
  actor: Actor,
  input: { projectId: string; baseCounter: number; content: ProjectDoc },
): Promise<SaveContentOutcome> {
  if (actor.status !== "active") return { ok: false, code: "not_found" };
  const [updated] = await db
    .update(projects)
    .set({
      editorContent: input.content,
      revisionCounter: sql`${projects.revisionCounter} + 1`,
      status: editingStatusSql,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.ownerId, actor.id),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt),
        eq(projects.revisionCounter, input.baseCounter),
        sql`${projects.status} <> 'drafting'`,
      ),
    )
    .returning({ counter: projects.revisionCounter });
  if (updated) return { ok: true, counter: updated.counter };

  const project = await getOwnedProject(db, actor, input.projectId);
  if (!project) return { ok: false, code: "not_found" };
  if (project.archivedAt) return { ok: false, code: "archived" };
  if (project.status === "drafting") return { ok: false, code: "busy" };
  return { ok: false, code: "conflict", counter: project.revisionCounter };
}

/** Titles frozen with the revision, so its References stay right if a source is renamed or removed. */
async function revisionSources(
  tx: Executor,
  ownerId: string,
  projectId: string,
  doc: ProjectDoc,
): Promise<RevisionSource[]> {
  const pinned = await tx
    .select({ versionId: projectSources.documentVersionId })
    .from(projectSources)
    .where(eq(projectSources.projectId, projectId));
  const versionIds = [
    ...new Set([
      ...pinned.map((row) => row.versionId),
      ...docReferences(doc).map((reference) => reference.versionId),
    ]),
  ];
  if (versionIds.length === 0) return [];
  const actor: Actor = { id: ownerId, status: "active" };
  const titles = new Map(
    (await readableSources(tx, actor, versionIds)).map((source) => [
      source.versionId,
      source.title,
    ]),
  );
  const missing = versionIds.filter((versionId) => !titles.has(versionId));
  if (missing.length > 0) {
    const own = await tx
      .select({ versionId: documentVersions.id, title: documents.title })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(and(inArray(documentVersions.id, missing), eq(documents.ownerId, ownerId)));
    for (const row of own) titles.set(row.versionId, row.title);
  }
  return versionIds.map((versionId) => ({
    versionId,
    title: titles.get(versionId) ?? "Source no longer available",
  }));
}

/**
 * The new immutable row, unless the latest revision already holds this text.
 * The caller's transaction holds the project's row lock, so numbers can't clash.
 */
export async function insertRevision(
  tx: Executor,
  input: {
    project: Pick<ProjectRecord, "id" | "ownerId" | "outline">;
    content: ProjectDoc;
    createdBy: string;
  },
): Promise<{ revision: ProjectRevisionView; created: boolean }> {
  const { project, content } = input;
  const [latest] = await tx
    .select({
      id: projectRevisions.id,
      revisionNo: projectRevisions.revisionNo,
      createdAt: projectRevisions.createdAt,
      same: sql<boolean>`${projectRevisions.content} = ${JSON.stringify(content)}::jsonb`,
    })
    .from(projectRevisions)
    .where(eq(projectRevisions.projectId, project.id))
    .orderBy(desc(projectRevisions.revisionNo))
    .limit(1);
  if (latest?.same) {
    return {
      revision: {
        id: latest.id,
        revisionNo: latest.revisionNo,
        createdAt: latest.createdAt.toISOString(),
      },
      created: false,
    };
  }
  const [row] = await tx
    .insert(projectRevisions)
    .values({
      projectId: project.id,
      revisionNo: (latest?.revisionNo ?? 0) + 1,
      content,
      outline: project.outline,
      citations: docReferences(content),
      sourceSnapshot: await revisionSources(tx, project.ownerId, project.id, content),
      createdBy: input.createdBy,
    })
    .returning({
      id: projectRevisions.id,
      revisionNo: projectRevisions.revisionNo,
      createdAt: projectRevisions.createdAt,
    });
  if (!row) throw new Error("Revision insert failed");
  return {
    revision: { id: row.id, revisionNo: row.revisionNo, createdAt: row.createdAt.toISOString() },
    created: true,
  };
}

export type SaveRevisionOutcome =
  | {
      ok: true;
      revision: ProjectRevisionView;
      created: boolean;
      /** Citation numbers may have changed, so the editor reloads this. */
      content: ProjectDoc;
      counter: number;
    }
  | { ok: false; code: "not_found" | "archived" | "busy" | "empty_document" };

/** "Save revision": freezes the project's current text with its citations and sources. */
export async function saveProjectRevision(
  db: Database,
  actor: Actor,
  projectId: string,
): Promise<SaveRevisionOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (project.archivedAt) return { ok: false, code: "archived" };
    if (project.status === "drafting") return { ok: false, code: "busy" };
    if (!docHasText(project.content)) return { ok: false, code: "empty_document" };
    const content = renumberCitations(project.content);
    const { revision, created } = await insertRevision(tx, {
      project,
      content,
      createdBy: actor.id,
    });
    // Nothing changed, so another tab's next save shouldn't count as a conflict.
    if (JSON.stringify(content) === JSON.stringify(project.content)) {
      return { ok: true, revision, created, content, counter: project.revisionCounter };
    }
    const [row] = await tx
      .update(projects)
      .set({
        editorContent: content,
        revisionCounter: sql`${projects.revisionCounter} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id))
      .returning({ counter: projects.revisionCounter });
    return {
      ok: true,
      revision,
      created,
      content,
      counter: row?.counter ?? project.revisionCounter,
    };
  });
}

/** What Preview shows: the saved text, in the same template the export would use. */
export async function getProjectPreview(
  db: Executor,
  actor: Actor,
  projectId: string,
): Promise<{
  title: string;
  mode: ProjectRecord["mode"];
  template: ProjectRecord["templateKey"];
  settings: ProjectRecord["settings"];
  content: ProjectDoc;
  sources: RevisionSource[];
} | null> {
  const project = await getOwnedProject(db, actor, projectId);
  if (!project) return null;
  return {
    title: project.title,
    mode: project.mode,
    template: project.templateKey,
    settings: project.settings,
    content: project.content,
    sources: await revisionSources(db, project.ownerId, project.id, project.content),
  };
}

export async function listProjectRevisions(
  db: Executor,
  projectId: string,
  limit = 20,
): Promise<ProjectRevisionView[]> {
  const rows = await db
    .select({
      id: projectRevisions.id,
      revisionNo: projectRevisions.revisionNo,
      createdAt: projectRevisions.createdAt,
    })
    .from(projectRevisions)
    .where(eq(projectRevisions.projectId, projectId))
    .orderBy(desc(projectRevisions.revisionNo))
    .limit(limit);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export type ContentChangeOutcome =
  | { ok: true; content: ProjectDoc; counter: number; status: ProjectStatus }
  | { ok: false; code: "conflict"; counter: number }
  | { ok: false; code: "not_found" | "archived" | "busy" | "section_missing" };

async function replaceContent(
  tx: Executor,
  actor: Actor,
  project: ProjectRecord,
  content: ProjectDoc,
  extra: { sectionProposals?: unknown } = {},
): Promise<ContentChangeOutcome> {
  // Whatever is about to be replaced stays recoverable as a revision.
  if (docHasText(project.content)) {
    await insertRevision(tx, {
      project,
      content: renumberCitations(project.content),
      createdBy: actor.id,
    });
  }
  const [row] = await tx
    .update(projects)
    .set({
      editorContent: content,
      revisionCounter: sql`${projects.revisionCounter} + 1`,
      status: editingStatusSql,
      updatedAt: sql`now()`,
      ...extra,
    })
    .where(eq(projects.id, project.id))
    .returning({ counter: projects.revisionCounter, status: projects.status });
  if (!row) throw new Error("Project update failed");
  return { ok: true, content, counter: row.counter, status: row.status as ProjectStatus };
}

/** Loads the project for a change that needs the editor to be up to date. */
async function lockForChange(
  tx: Executor,
  actor: Actor,
  projectId: string,
  baseCounter: number,
): Promise<ProjectRecord | Exclude<ContentChangeOutcome, { ok: true }>> {
  const project = await getOwnedProject(tx, actor, projectId, { lock: true });
  if (!project) return { ok: false, code: "not_found" };
  if (project.archivedAt) return { ok: false, code: "archived" };
  if (project.status === "drafting") return { ok: false, code: "busy" };
  if (project.revisionCounter !== baseCounter) {
    return { ok: false, code: "conflict", counter: project.revisionCounter };
  }
  return project;
}

const isOutcome = (
  value: ProjectRecord | Exclude<ContentChangeOutcome, { ok: true }>,
): value is Exclude<ContentChangeOutcome, { ok: true }> => "ok" in value;

/** The owner confirmed a regenerated section: it replaces theirs (Section 5 row 11). */
export async function acceptSectionProposal(
  db: Database,
  actor: Actor,
  input: { projectId: string; sectionId: string; baseCounter: number },
): Promise<ContentChangeOutcome> {
  return db.transaction(async (tx) => {
    const project = await lockForChange(tx, actor, input.projectId, input.baseCounter);
    if (isOutcome(project)) return project;
    const proposal = project.proposals.find((item) => item.sectionId === input.sectionId);
    if (!proposal || !sectionNodes(project.content, input.sectionId)) {
      return { ok: false, code: "section_missing" };
    }
    const content = renumberCitations(
      upsertDocSection(
        project.content,
        { sectionId: input.sectionId, nodes: proposal.nodes },
        project.outline.map((section) => section.id),
      ),
    );
    return replaceContent(tx, actor, project, content, {
      sectionProposals: project.proposals.filter((item) => item.sectionId !== input.sectionId),
    });
  });
}

/** The owner kept their own text; the proposal goes and the allowance stays spent. */
export async function declineSectionProposal(
  db: Database,
  actor: Actor,
  input: { projectId: string; sectionId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return false;
    await tx
      .update(projects)
      .set({
        sectionProposals: project.proposals.filter((item) => item.sectionId !== input.sectionId),
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id));
    return true;
  });
}

/** Back to an earlier revision, keeping the current text as a revision of its own. */
export async function restoreProjectRevision(
  db: Database,
  actor: Actor,
  input: { projectId: string; revisionId: string; baseCounter: number },
): Promise<ContentChangeOutcome> {
  return db.transaction(async (tx) => {
    const project = await lockForChange(tx, actor, input.projectId, input.baseCounter);
    if (isOutcome(project)) return project;
    if (await liveProjectJob(tx, project.id)) return { ok: false, code: "busy" };
    const [revision] = await tx
      .select({ content: projectRevisions.content })
      .from(projectRevisions)
      .where(
        and(eq(projectRevisions.id, input.revisionId), eq(projectRevisions.projectId, project.id)),
      );
    if (!revision) return { ok: false, code: "not_found" };
    return replaceContent(tx, actor, project, readProjectDoc(revision.content));
  });
}

/**
 * The conflict dialog's "keep this tab's text": what the other tab saved becomes
 * a revision, then this tab's text is saved on top, so neither is lost.
 */
export async function overwriteAfterConflict(
  db: Database,
  actor: Actor,
  input: { projectId: string; content: ProjectDoc },
): Promise<ContentChangeOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (project.archivedAt) return { ok: false, code: "archived" };
    if (project.status === "drafting") return { ok: false, code: "busy" };
    return replaceContent(tx, actor, project, input.content);
  });
}

/**
 * The conflict dialog's "use the other tab's text": this tab's unsaved text is
 * kept as a revision before the editor reloads.
 */
export async function keepTextAsRevision(
  db: Database,
  actor: Actor,
  input: { projectId: string; content: ProjectDoc },
): Promise<ContentChangeOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (docHasText(input.content)) {
      await insertRevision(tx, {
        project,
        content: renumberCitations(input.content),
        createdBy: actor.id,
      });
    }
    return {
      ok: true,
      content: project.content ?? EMPTY_PROJECT_DOC,
      counter: project.revisionCounter,
      status: project.status,
    };
  });
}
