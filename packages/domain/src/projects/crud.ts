import {
  PROJECT_SOURCES_MAX,
  PROJECT_STATUS_FILTERS,
  PROJECT_STATUSES,
  docHasText,
  type OutlineSection,
  type ProjectMode,
  type ProjectStatus,
  type ProjectTemplate,
  type StudioSettingsValues,
} from "@foliomind/contracts";
import {
  assets,
  exports as projectExports,
  jobs,
  projectRevisions,
  projects,
  projectSources,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { readableSources, type Actor } from "../access";
import { decodeCursor, encodeCursor } from "../library";
import { getOwnedProject, liveProjectJob, settledStatus, type ProjectRecord } from "./records";

/*
 * Project CRUD (blueprint Sections 11 and 24). Creating a project charges
 * nothing: the credit is taken when an outline is generated (Section 10).
 */

export interface ProjectListItem {
  id: string;
  title: string;
  mode: ProjectMode;
  templateKey: ProjectTemplate;
  status: ProjectStatus;
  archived: boolean;
  sourceCount: number;
  /** The newest finished export, for the row's Download action. */
  latestExportId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectListQuery {
  userId: string;
  q?: string | undefined;
  status?: keyof typeof PROJECT_STATUS_FILTERS | "all" | undefined;
  mode?: ProjectMode | "all" | undefined;
  template?: ProjectTemplate | "all" | undefined;
  archived?: boolean | undefined;
  sort: "updated" | "created" | "title";
  after?: string | undefined;
  before?: string | undefined;
  limit: number;
}

export interface ProjectListPage {
  items: ProjectListItem[];
  /** Pass as `after` for the next page. */
  nextCursor: string | null;
  /** Pass as `before` for the previous page. */
  prevCursor: string | null;
}

const STATUS_VALUES: readonly string[] = PROJECT_STATUSES;

/**
 * My Projects (Section 24): the owner's rows first, then filters, then keyset
 * Previous and Next with `limit + 1` signalling the page beyond.
 */
export async function listProjects(
  db: Executor,
  query: ProjectListQuery,
): Promise<ProjectListPage> {
  const filters: SQL[] = [
    sql`p.owner_id = ${query.userId}`,
    sql`p.deleted_at is null`,
    query.archived ? sql`p.archived_at is not null` : sql`p.archived_at is null`,
  ];
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    filters.push(sql`p.title ilike ${pattern}`);
  }
  if (query.status && query.status !== "all") {
    const statuses = PROJECT_STATUS_FILTERS[query.status].filter((status) =>
      STATUS_VALUES.includes(status),
    );
    filters.push(
      sql`p.status in (${sql.join(
        statuses.map((status) => sql`${status}`),
        sql`, `,
      )})`,
    );
  }
  if (query.mode && query.mode !== "all") filters.push(sql`p.mode = ${query.mode}`);
  if (query.template && query.template !== "all") {
    filters.push(sql`p.template_key = ${query.template}`);
  }

  const sortKey =
    query.sort === "title"
      ? sql`lower(p.title)`
      : query.sort === "created"
        ? sql`p.created_at`
        : sql`p.updated_at`;
  const ascending = query.sort === "title";
  const backward = Boolean(query.before) && !query.after;
  const cursor = decodeCursor(query.after ?? query.before);
  // Going back walks the same order in reverse, then flips the page.
  const walkAscending = ascending !== backward;
  if (cursor) {
    const value = ascending ? sql`${cursor.v}` : sql`${cursor.v}::timestamptz`;
    filters.push(
      walkAscending
        ? sql`(${sortKey}, p.id) > (${value}, ${cursor.id}::uuid)`
        : sql`(${sortKey}, p.id) < (${value}, ${cursor.id}::uuid)`,
    );
  }
  const direction = walkAscending ? sql`asc` : sql`desc`;
  const rows = await db.execute<{
    id: string;
    title: string;
    mode: ProjectMode;
    template_key: ProjectTemplate;
    status: ProjectStatus;
    archived_at: string | null;
    source_count: number;
    latest_export_id: string | null;
    created_at: string;
    updated_at: string;
    sort_value: string;
  }>(sql`
    select
      p.id, p.title, p.mode, p.template_key, p.status, p.archived_at, p.created_at, p.updated_at,
      (select count(*)::int from project_sources ps where ps.project_id = p.id) as source_count,
      (
        select e.id from exports e
        join project_revisions r on r.id = e.project_revision_id
        where r.project_id = p.id and e.status = 'ready'
        order by e.created_at desc, e.id desc
        limit 1
      ) as latest_export_id,
      (${sortKey})::text as sort_value
    from projects p
    where ${sql.join(filters, sql` and `)}
    order by ${sortKey} ${direction}, p.id ${direction}
    limit ${query.limit + 1}`);

  const hasExtra = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  if (backward) page.reverse();
  const first = page[0];
  const last = page.at(-1);
  const hasNext = backward ? Boolean(cursor) : hasExtra;
  const hasPrev = backward ? hasExtra : Boolean(cursor);
  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      mode: row.mode,
      templateKey: row.template_key,
      status: row.status,
      archived: row.archived_at !== null,
      sourceCount: Number(row.source_count),
      latestExportId: row.latest_export_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })),
    nextCursor: hasNext && last ? encodeCursor({ v: last.sort_value, id: last.id }) : null,
    prevCursor: hasPrev && first ? encodeCursor({ v: first.sort_value, id: first.id }) : null,
  };
}

export type CreateProjectOutcome =
  { ok: true; projectId: string } | { ok: false; code: "account_inactive" | "source_unavailable" };

/** Only versions the actor can read, and that are ready, can become project sources. */
export async function createProject(
  db: Database,
  actor: Actor,
  input: { title: string; mode: ProjectMode; versionIds: readonly string[] },
): Promise<CreateProjectOutcome> {
  if (actor.status !== "active") return { ok: false, code: "account_inactive" };
  const versionIds = input.mode === "research" ? [...new Set(input.versionIds)] : [];
  const usable = (await readableSources(db, actor, versionIds)).filter(
    (source) => source.status === "ready",
  );
  if (usable.length !== versionIds.length) return { ok: false, code: "source_unavailable" };
  const projectId = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        ownerId: actor.id,
        title: input.title,
        mode: input.mode,
        prompt: "",
        templateKey: "academic-report",
        status: "draft",
      })
      .returning({ id: projects.id });
    if (!project) throw new Error("Project insert failed");
    if (versionIds.length > 0) {
      await tx
        .insert(projectSources)
        .values(
          versionIds.map((versionId) => ({ projectId: project.id, documentVersionId: versionId })),
        );
    }
    return project.id;
  });
  return { ok: true, projectId };
}

export async function renameProject(
  db: Executor,
  actor: Actor,
  input: { projectId: string; title: string },
): Promise<boolean> {
  if (actor.status !== "active") return false;
  const rows = await db
    .update(projects)
    .set({ title: input.title, updatedAt: sql`now()` })
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.ownerId, actor.id),
        isNull(projects.deletedAt),
      ),
    )
    .returning({ id: projects.id });
  return rows.length > 0;
}

const COPY_SUFFIX = " (copy)";

/**
 * Copies settings, outline, content and sources; not exports or revisions
 * (Phase 8 skill). The copy has no credit of its own, so drafting it spends one.
 */
export async function duplicateProject(
  db: Database,
  actor: Actor,
  projectId: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, projectId);
    if (!project) return null;
    const hasText = docHasText(project.content);
    const [copy] = await tx
      .insert(projects)
      .values({
        ownerId: actor.id,
        workspaceId: project.workspaceId,
        title: `${project.title.slice(0, 120 - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
        mode: project.mode,
        prompt: project.prompt,
        settings: project.settings,
        templateKey: project.templateKey,
        outline: project.outline,
        editorContent: project.content,
        status: settledStatus(project),
        firstDraftAt: hasText ? project.firstDraftAt : null,
      })
      .returning({ id: projects.id });
    if (!copy) throw new Error("Project copy failed");
    const sources = await tx
      .select({ documentVersionId: projectSources.documentVersionId })
      .from(projectSources)
      .where(eq(projectSources.projectId, projectId));
    if (sources.length > 0) {
      await tx
        .insert(projectSources)
        .values(sources.map((source) => ({ ...source, projectId: copy.id })));
    }
    return copy.id;
  });
}

export type ArchiveOutcome = { ok: true } | { ok: false; code: "not_found" | "busy" };

export async function setProjectArchived(
  db: Database,
  actor: Actor,
  input: { projectId: string; archived: boolean },
): Promise<ArchiveOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (input.archived && (await liveProjectJob(tx, project.id))) {
      return { ok: false, code: "busy" };
    }
    await tx
      .update(projects)
      .set({ archivedAt: input.archived ? sql`now()` : null, updatedAt: sql`now()` })
      .where(eq(projects.id, project.id));
    return { ok: true };
  });
}

/**
 * Soft delete (Section 11): access stops now, a running job is stopped and its
 * exports' files are queued for the Phase 6 cleanup. The daily cleanup removes
 * the row. Returns the job to cancel so the caller can release its charge.
 */
export async function softDeleteProject(
  db: Database,
  actor: Actor,
  projectId: string,
): Promise<{ deleted: boolean; stoppedJobId: string | null }> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, projectId, { lock: true });
    if (!project) return { deleted: false, stoppedJobId: null };
    const live = await liveProjectJob(tx, projectId);
    if (live) {
      await tx
        .update(jobs)
        .set({
          status: "cancelled",
          cancelRequested: true,
          safeErrorCode: "cancelled",
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, live.id));
    }
    await tx
      .update(projects)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(projects.id, projectId));
    await tx
      .update(assets)
      .set({ state: "deleting", updatedAt: sql`now()` })
      .where(
        and(
          inArray(
            assets.id,
            tx
              .select({ id: sql`${projectExports.assetId}` })
              .from(projectExports)
              .innerJoin(
                projectRevisions,
                eq(projectRevisions.id, projectExports.projectRevisionId),
              )
              .where(
                and(eq(projectRevisions.projectId, projectId), isNotNull(projectExports.assetId)),
              ),
          ),
          inArray(assets.state, ["pending", "ready"]),
        ),
      );
    return { deleted: true, stoppedJobId: live?.id ?? null };
  });
}

/** How long a deleted project's row waits before the cleanup removes it. */
const PROJECT_PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Daily cleanup: removes deleted projects' rows, which takes their text,
 * revisions and export records with them. Their files were queued at deletion.
 */
export async function purgeDeletedProjects(
  db: Executor,
  { now = new Date(), limit = 100 }: { now?: Date; limit?: number } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - PROJECT_PURGE_AFTER_MS);
  const batch = await db
    .select({ id: projects.id })
    .from(projects)
    .where(lt(projects.deletedAt, cutoff))
    .limit(limit);
  if (batch.length === 0) return 0;
  const removed = await db
    .delete(projects)
    .where(
      inArray(
        projects.id,
        batch.map((row) => row.id),
      ),
    )
    .returning({ id: projects.id });
  return removed.length;
}

export type SettingsOutcome =
  | { ok: true; project: ProjectRecord }
  | { ok: false; code: "not_found" | "archived" | "busy" | "mode_locked" };

/** The Studio rail. The mode locks once a draft exists, so a document never mixes the two. */
export async function saveStudioSettings(
  db: Database,
  actor: Actor,
  input: { projectId: string } & StudioSettingsValues,
): Promise<SettingsOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (project.archivedAt) return { ok: false, code: "archived" };
    if (await liveProjectJob(tx, project.id)) return { ok: false, code: "busy" };
    if (input.mode !== project.mode && docHasText(project.content)) {
      return { ok: false, code: "mode_locked" };
    }
    const settings = {
      audience: input.audience,
      length: input.length,
      pageSize: input.pageSize,
      cover: input.cover,
      contents: input.contents,
    };
    await tx
      .update(projects)
      .set({
        prompt: input.prompt,
        settings,
        templateKey: input.template,
        mode: input.mode,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id));
    return {
      ok: true,
      project: {
        ...project,
        prompt: input.prompt,
        settings,
        templateKey: input.template,
        mode: input.mode,
      },
    };
  });
}

export type OutlineOutcome = { ok: true } | { ok: false; code: "not_found" | "archived" | "busy" };

/** The owner's edits to the outline; the draft doesn't start until they approve it. */
export async function saveProjectOutline(
  db: Database,
  actor: Actor,
  input: { projectId: string; outline: OutlineSection[] },
): Promise<OutlineOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (project.archivedAt) return { ok: false, code: "archived" };
    if (await liveProjectJob(tx, project.id)) return { ok: false, code: "busy" };
    await tx
      .update(projects)
      .set({ outline: input.outline, updatedAt: sql`now()` })
      .where(eq(projects.id, project.id));
    return { ok: true };
  });
}

export type SourceChangeOutcome =
  | { ok: true }
  | {
      ok: false;
      code: "not_found" | "archived" | "busy" | "source_limit" | "not_ready" | "already_added";
    };

/** Adds a pinned version: the source as it is now, not whatever it later becomes (Section 8). */
export async function addProjectSource(
  db: Database,
  actor: Actor,
  input: { projectId: string; versionId: string },
): Promise<SourceChangeOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (project.archivedAt) return { ok: false, code: "archived" };
    if (await liveProjectJob(tx, project.id)) return { ok: false, code: "busy" };
    const [source] = await readableSources(tx, actor, [input.versionId]);
    if (!source) return { ok: false, code: "not_found" };
    if (source.status !== "ready") return { ok: false, code: "not_ready" };
    const existing = await tx
      .select({ versionId: projectSources.documentVersionId })
      .from(projectSources)
      .where(eq(projectSources.projectId, project.id));
    if (existing.some((row) => row.versionId === input.versionId)) {
      return { ok: false, code: "already_added" };
    }
    if (existing.length >= PROJECT_SOURCES_MAX) return { ok: false, code: "source_limit" };
    await tx
      .insert(projectSources)
      .values({ projectId: project.id, documentVersionId: input.versionId });
    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, project.id));
    return { ok: true };
  });
}

/** Citations in existing text keep pointing at the version they cite. */
export async function removeProjectSource(
  db: Database,
  actor: Actor,
  input: { projectId: string; versionId: string },
): Promise<SourceChangeOutcome> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, actor, input.projectId, { lock: true });
    if (!project) return { ok: false, code: "not_found" };
    if (await liveProjectJob(tx, project.id)) return { ok: false, code: "busy" };
    await tx
      .delete(projectSources)
      .where(
        and(
          eq(projectSources.projectId, project.id),
          eq(projectSources.documentVersionId, input.versionId),
        ),
      );
    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, project.id));
    return { ok: true };
  });
}
