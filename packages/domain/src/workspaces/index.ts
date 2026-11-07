import {
  answerToNoteDoc,
  citationRefSchema,
  EMPTY_NOTE_DOC,
  noteDocSchema,
  PROJECT_TEMPLATES,
  type CitationRef,
  type NoteDoc,
  type SOURCE_PICKER_TYPES,
  type ThreadView,
} from "@foliomind/contracts";
import type { WORKSPACE_SORTS } from "@foliomind/contracts/search-params";
import {
  conversations,
  documents,
  documentVersions,
  messages,
  projects,
  projectSources,
  workspaceNotes,
  workspaces,
  workspaceSources,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ownsWorkspace, readableSources, type Actor } from "../access";
import { listMessages, listThreads } from "../conversations";
import { currentEntitlement } from "../entitlements";
import { decodeCursor, encodeCursor } from "../library";

/*
 * Research Workspaces (blueprint Sections 5, 11, 12 and 24). A workspace belongs
 * to one user and refers to immutable document versions. A reference never
 * grants access: permission is checked when a source is added and again on each
 * use, so a revoked source stops participating immediately. Deleting a
 * workspace keeps the original documents.
 */

export interface WorkspaceCardData {
  id: string;
  name: string;
  description: string | null;
  sourceCount: number;
  updatedAt: Date;
}

export async function createWorkspace(
  db: Executor,
  actor: Actor,
  input: { name: string; description?: string | undefined },
): Promise<WorkspaceCardData | null> {
  if (actor.status !== "active") return null;
  const [row] = await db
    .insert(workspaces)
    .values({ ownerId: actor.id, name: input.name, description: input.description || null })
    .returning();
  return row
    ? {
        id: row.id,
        name: row.name,
        description: row.description,
        sourceCount: 0,
        updatedAt: row.updatedAt,
      }
    : null;
}

export async function updateWorkspace(
  db: Executor,
  actor: Actor,
  workspaceId: string,
  input: { name: string; description?: string | undefined },
): Promise<boolean> {
  const rows = await db
    .update(workspaces)
    .set({ name: input.name, description: input.description || null })
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, actor.id)))
    .returning({ id: workspaces.id });
  return rows.length > 0;
}

/** Sources, notes and conversations go with it; the original documents stay. */
export async function deleteWorkspace(
  db: Executor,
  actor: Actor,
  workspaceId: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, actor.id)))
    .returning({ id: workspaces.id });
  return rows.length > 0;
}

export async function listWorkspaces(
  db: Executor,
  query: {
    userId: string;
    q?: string | undefined;
    sort: (typeof WORKSPACE_SORTS)[number];
    cursor?: string | undefined;
    limit: number;
  },
): Promise<{ items: WorkspaceCardData[]; nextCursor: string | null }> {
  const filters: SQL[] = [sql`w.owner_id = ${query.userId}`];
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    filters.push(sql`w.name ilike ${pattern}`);
  }
  const byName = query.sort === "name";
  const sortKey = byName ? sql`lower(w.name)` : sql`w.updated_at`;
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    filters.push(
      byName
        ? sql`(lower(w.name), w.id) > (${cursor.v}, ${cursor.id}::uuid)`
        : sql`(w.updated_at, w.id) < (${cursor.v}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  const direction = byName ? sql`asc` : sql`desc`;
  const rows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    updated_at: string;
    source_count: number;
    sort_value: string;
  }>(sql`
    select
      w.id, w.name, w.description, w.updated_at,
      (select count(*)::int from workspace_sources s where s.workspace_id = w.id) as source_count,
      (${sortKey})::text as sort_value
    from workspaces w
    where ${sql.join(filters, sql` and `)}
    order by ${sortKey} ${direction}, w.id ${direction}
    limit ${query.limit + 1}`);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      sourceCount: Number(row.source_count),
      updatedAt: new Date(row.updated_at),
    })),
    nextCursor:
      rows.length > query.limit && last ? encodeCursor({ v: last.sort_value, id: last.id }) : null,
  };
}

/* --- Sources ---------------------------------------------------------- */

export interface WorkspaceSourceView {
  versionId: string;
  documentId: string | null;
  title: string;
  position: number;
  /** False once the source was deleted, unpublished or otherwise revoked. */
  available: boolean;
  /** A newer version of the document exists; this one still answers. */
  superseded: boolean;
}

/**
 * The workspace's sources in rail order, with access checked now. A source the
 * actor can no longer read keeps a row, but only its own document's title.
 */
export async function listWorkspaceSources(
  db: Executor,
  actor: Actor,
  workspaceId: string,
): Promise<WorkspaceSourceView[]> {
  const rows = await db
    .select({
      versionId: workspaceSources.documentVersionId,
      position: workspaceSources.position,
      documentTitle: documents.title,
      ownerId: documents.ownerId,
    })
    .from(workspaceSources)
    .innerJoin(documentVersions, eq(documentVersions.id, workspaceSources.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(workspaceSources.workspaceId, workspaceId))
    .orderBy(asc(workspaceSources.position), asc(workspaceSources.createdAt));
  const readable = new Map(
    (
      await readableSources(
        db,
        actor,
        rows.map((row) => row.versionId),
      )
    ).map((source) => [source.versionId, source]),
  );
  return rows.map((row) => {
    const source = readable.get(row.versionId);
    const usable = source?.status === "ready";
    return {
      versionId: row.versionId,
      documentId: usable ? source.documentId : null,
      title:
        source?.title ??
        (row.ownerId === actor.id ? row.documentTitle : "Source no longer available"),
      position: row.position,
      available: usable,
      superseded: usable && !source.isCurrent,
    };
  });
}

export type AddSourceResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "not_ready" | "already_added" }
  | { ok: false; code: "source_limit"; limit: number; planCode: string };

/**
 * Adds a ready source the actor can read, under the plan's cap. The workspace
 * row is locked for the count and insert, so parallel additions cannot pass it.
 */
export async function addWorkspaceSource(
  db: Database,
  actor: Actor,
  input: { workspaceId: string; versionId: string },
): Promise<AddSourceResult> {
  if (actor.status !== "active") return { ok: false, code: "not_found" };
  const { limits, planCode } = await currentEntitlement(db, actor.id);
  return db.transaction(async (tx): Promise<AddSourceResult> => {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.ownerId, actor.id)))
      .for("update");
    if (!workspace) return { ok: false, code: "not_found" };

    const [source] = await readableSources(tx, actor, [input.versionId]);
    if (!source) return { ok: false, code: "not_found" };
    if (source.status !== "ready") return { ok: false, code: "not_ready" };

    const [counts] = await tx
      .select({
        count: sql<number>`count(*)::int`.mapWith(Number),
        next: sql<number>`coalesce(max(${workspaceSources.position}) + 1, 0)::int`.mapWith(Number),
        present:
          sql<number>`count(*) filter (where ${workspaceSources.documentVersionId} = ${input.versionId})::int`.mapWith(
            Number,
          ),
      })
      .from(workspaceSources)
      .where(eq(workspaceSources.workspaceId, input.workspaceId));
    if ((counts?.present ?? 0) > 0) return { ok: false, code: "already_added" };
    if ((counts?.count ?? 0) >= limits.workspaceSourcesMax) {
      return { ok: false, code: "source_limit", limit: limits.workspaceSourcesMax, planCode };
    }
    await tx.insert(workspaceSources).values({
      workspaceId: input.workspaceId,
      documentVersionId: input.versionId,
      addedBy: actor.id,
      position: counts?.next ?? 0,
    });
    await tx
      .update(workspaces)
      .set({ updatedAt: sql`now()` })
      .where(eq(workspaces.id, input.workspaceId));
    return { ok: true };
  });
}

export async function removeWorkspaceSource(
  db: Database,
  actor: Actor,
  input: { workspaceId: string; versionId: string },
): Promise<boolean> {
  if (!(await ownsWorkspace(db, actor, input.workspaceId))) return false;
  const rows = await db
    .delete(workspaceSources)
    .where(
      and(
        eq(workspaceSources.workspaceId, input.workspaceId),
        eq(workspaceSources.documentVersionId, input.versionId),
      ),
    )
    .returning({ id: workspaceSources.workspaceId });
  if (rows.length > 0) {
    await db
      .update(workspaces)
      .set({ updatedAt: sql`now()` })
      .where(eq(workspaces.id, input.workspaceId));
  }
  return rows.length > 0;
}

export interface SourceCandidate {
  versionId: string;
  title: string;
  kind: "upload" | "imported" | "saved";
}

/**
 * The source picker (Section 24): ready documents the actor can read and hasn't
 * added yet, recently opened first. Only ready versions are ever offered.
 */
export async function listSourceCandidates(
  db: Executor,
  actor: Actor,
  query: {
    /** Leaves out what's already in this workspace; a project's picker passes none. */
    workspaceId?: string | undefined;
    /** Leaves out versions the caller already picked. */
    excludeVersionIds?: readonly string[] | undefined;
    q?: string | undefined;
    type: (typeof SOURCE_PICKER_TYPES)[number];
    cursor?: string | undefined;
    limit: number;
  },
): Promise<{ items: SourceCandidate[]; nextCursor: string | null } | null> {
  if (actor.status !== "active") return null;
  if (query.workspaceId && !(await ownsWorkspace(db, actor, query.workspaceId))) return null;
  const filters: SQL[] = [];
  if (query.excludeVersionIds && query.excludeVersionIds.length > 0) {
    filters.push(
      sql`version_id not in (${sql.join(
        query.excludeVersionIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  }
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    filters.push(sql`title ilike ${pattern}`);
  }
  if (query.type === "uploads") filters.push(sql`kind = 'upload'`);
  if (query.type === "imported") filters.push(sql`kind = 'imported'`);
  if (query.type === "saved") filters.push(sql`kind = 'saved'`);
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    filters.push(sql`(sort_at, version_id) < (${cursor.v}::timestamptz, ${cursor.id}::uuid)`);
  }
  const where = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
  const rows = await db.execute<{
    version_id: string;
    title: string;
    kind: SourceCandidate["kind"];
    sort_value: string;
  }>(sql`
    with candidates as (
      select
        coalesce(d.current_version_id, br.document_version_id) as version_id,
        coalesce(d.title, br.title) as title,
        case
          when li.book_id is not null then 'saved'
          when d.source_kind = 'url_import' then 'imported'
          else 'upload'
        end as kind,
        coalesce(
          (
            select max(rp.last_read_at)
            from reading_progress rp
            where rp.user_id = li.user_id
              and rp.document_version_id = coalesce(d.current_version_id, br.document_version_id)
          ),
          li.created_at
        ) as sort_at
      from library_items li
      left join documents d on d.id = li.document_id
      left join books b on b.id = li.book_id
      left join book_revisions br on br.id = b.published_revision_id
      where li.user_id = ${actor.id}
        and (li.document_id is null or (d.status = 'active' and d.deleted_at is null and d.owner_id = ${actor.id}))
        and (li.book_id is null or (b.status = 'published' and b.deleted_at is null and br.status = 'approved'))
    ),
    ready as (
      select c.*
      from candidates c
      join document_versions v on v.id = c.version_id
      where v.status = 'ready'
        ${
          query.workspaceId
            ? sql`and not exists (
          select 1 from workspace_sources s
          where s.workspace_id = ${query.workspaceId} and s.document_version_id = c.version_id
        )`
            : sql``
        }
    )
    select version_id, title, kind, sort_at::text as sort_value
    from ready
    ${where}
    order by sort_at desc, version_id desc
    limit ${query.limit + 1}`);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ versionId: row.version_id, title: row.title, kind: row.kind })),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ v: last.sort_value, id: last.version_id })
        : null,
  };
}

/* --- Notes ------------------------------------------------------------ */

export interface WorkspaceNoteView {
  id: string;
  body: NoteDoc;
  sourceMessageId: string | null;
  citations: CitationRef[];
  updatedAt: Date;
}

const noteColumns = {
  id: workspaceNotes.id,
  body: workspaceNotes.body,
  sourceMessageId: workspaceNotes.sourceMessageId,
  citationRefs: workspaceNotes.citationRefs,
  updatedAt: workspaceNotes.updatedAt,
};

const toNoteView = (row: {
  id: string;
  body: unknown;
  sourceMessageId: string | null;
  citationRefs: unknown;
  updatedAt: Date;
}): WorkspaceNoteView => ({
  id: row.id,
  body: noteDocSchema.catch(EMPTY_NOTE_DOC).parse(row.body),
  sourceMessageId: row.sourceMessageId,
  citations: z.array(citationRefSchema).catch([]).parse(row.citationRefs),
  updatedAt: row.updatedAt,
});

export async function listWorkspaceNotes(
  db: Executor,
  workspaceId: string,
): Promise<WorkspaceNoteView[]> {
  const rows = await db
    .select(noteColumns)
    .from(workspaceNotes)
    .where(eq(workspaceNotes.workspaceId, workspaceId))
    .orderBy(desc(workspaceNotes.createdAt), desc(workspaceNotes.id));
  return rows.map(toNoteView);
}

export async function createWorkspaceNote(
  db: Executor,
  actor: Actor,
  workspaceId: string,
): Promise<WorkspaceNoteView | null> {
  if (!(await ownsWorkspace(db, actor, workspaceId))) return null;
  const [row] = await db
    .insert(workspaceNotes)
    .values({ workspaceId, authorId: actor.id, body: EMPTY_NOTE_DOC })
    .returning(noteColumns);
  return row ? toNoteView(row) : null;
}

const ownNote = (noteId: string, actor: Actor) =>
  and(
    eq(workspaceNotes.id, noteId),
    eq(workspaceNotes.authorId, actor.id),
    inArray(
      workspaceNotes.workspaceId,
      sql`(select ${workspaces.id} from ${workspaces} where ${workspaces.ownerId} = ${actor.id})`,
    ),
  );

export async function updateWorkspaceNote(
  db: Executor,
  actor: Actor,
  noteId: string,
  body: NoteDoc,
): Promise<WorkspaceNoteView | null> {
  if (actor.status !== "active") return null;
  const [row] = await db
    .update(workspaceNotes)
    .set({ body })
    .where(ownNote(noteId, actor))
    .returning(noteColumns);
  return row ? toNoteView(row) : null;
}

export async function deleteWorkspaceNote(
  db: Executor,
  actor: Actor,
  noteId: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceNotes)
    .where(ownNote(noteId, actor))
    .returning({ id: workspaceNotes.id });
  return rows.length > 0;
}

/**
 * Save to notes: the server builds the note from the stored answer, keeping its
 * message and citations. Saving the same answer twice returns the same note.
 */
export async function saveAnswerToNotes(
  db: Database,
  actor: Actor,
  input: { workspaceId: string; messageId: string },
): Promise<WorkspaceNoteView | null> {
  if (!(await ownsWorkspace(db, actor, input.workspaceId))) return null;
  const [message] = await db
    .select({ conversationId: messages.conversationId, role: messages.role, body: messages.body })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.id, input.messageId),
        eq(conversations.userId, actor.id),
        eq(conversations.workspaceId, input.workspaceId),
      ),
    );
  if (!message || message.role !== "assistant") return null;

  const [existing] = await db
    .select(noteColumns)
    .from(workspaceNotes)
    .where(
      and(
        eq(workspaceNotes.workspaceId, input.workspaceId),
        eq(workspaceNotes.sourceMessageId, input.messageId),
      ),
    );
  if (existing) return toNoteView(existing);

  // listMessages reads citations with the actor's current access.
  const thread = await listMessages(db, actor, message.conversationId, { limit: 200 });
  const citations = thread?.messages.find((item) => item.id === input.messageId)?.citations ?? [];
  const [row] = await db
    .insert(workspaceNotes)
    .values({
      workspaceId: input.workspaceId,
      authorId: actor.id,
      body: answerToNoteDoc(message.body),
      sourceMessageId: input.messageId,
      citationRefs: citations.map(({ label, versionId, title, pageStart, pageEnd }) => ({
        label,
        versionId,
        title,
        pageStart,
        pageEnd,
      })),
    })
    .returning(noteColumns);
  if (!row) return null;
  await db
    .update(workspaces)
    .set({ updatedAt: sql`now()` })
    .where(eq(workspaces.id, input.workspaceId));
  return toNoteView(row);
}

/* --- Detail and projects ---------------------------------------------- */

export interface WorkspaceDetail {
  id: string;
  name: string;
  description: string | null;
  sources: WorkspaceSourceView[];
  notes: WorkspaceNoteView[];
  threads: ThreadView[];
  sourceLimit: number;
  planCode: string;
}

export async function getWorkspaceDetail(
  db: Executor,
  actor: Actor,
  workspaceId: string,
): Promise<WorkspaceDetail | null> {
  if (actor.status !== "active") return null;
  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name, description: workspaces.description })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, actor.id)));
  if (!workspace) return null;
  const [sources, notes, threads, entitlement] = await Promise.all([
    listWorkspaceSources(db, actor, workspaceId),
    listWorkspaceNotes(db, workspaceId),
    listThreads(db, actor.id, { workspaceId }),
    currentEntitlement(db, actor.id),
  ]);
  return {
    ...workspace,
    sources,
    notes,
    threads,
    sourceLimit: entitlement.limits.workspaceSourcesMax,
    planCode: entitlement.planCode,
  };
}

export type CreateProjectResult =
  { ok: true; projectId: string } | { ok: false; code: "not_found" | "no_sources" };

/**
 * Turn into a PDF: a research project carrying the selected source versions.
 * Only versions that are in this workspace and readable and ready right now are
 * kept. Generation and its allowance belong to PDF Studio (Phase 8).
 */
export async function createProjectFromWorkspace(
  db: Database,
  actor: Actor,
  input: { workspaceId: string; versionIds: readonly string[] },
): Promise<CreateProjectResult> {
  if (actor.status !== "active") return { ok: false, code: "not_found" };
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.ownerId, actor.id)));
  if (!workspace) return { ok: false, code: "not_found" };

  const inWorkspace = await db
    .select({ versionId: workspaceSources.documentVersionId })
    .from(workspaceSources)
    .where(
      and(
        eq(workspaceSources.workspaceId, input.workspaceId),
        inArray(workspaceSources.documentVersionId, [...input.versionIds]),
      ),
    );
  const usable = (
    await readableSources(
      db,
      actor,
      inWorkspace.map((row) => row.versionId),
    )
  ).filter((source) => source.status === "ready");
  if (usable.length === 0) return { ok: false, code: "no_sources" };

  const projectId = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        ownerId: actor.id,
        workspaceId: input.workspaceId,
        title: workspace.name,
        mode: "research",
        prompt: "",
        templateKey: PROJECT_TEMPLATES[0],
        status: "draft",
      })
      .returning({ id: projects.id });
    if (!project) throw new Error("Project insert failed");
    await tx
      .insert(projectSources)
      .values(
        usable.map((source) => ({ projectId: project.id, documentVersionId: source.versionId })),
      );
    return project.id;
  });
  return { ok: true, projectId };
}
