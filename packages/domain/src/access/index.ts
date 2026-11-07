import {
  collections,
  documents,
  libraryItems,
  projects,
  workspaces,
  type Executor,
} from "@foliomind/db";
import { and, eq, exists, isNull, sql } from "drizzle-orm";

/*
 * Access policy (blueprint Sections 4 and 12). Roles never replace ownership:
 * an admin gets no routine access to private documents, chats or projects.
 * Saved-item or workspace references never grant access on their own.
 */

/** The parts of the current user every policy needs. */
export interface Actor {
  id: string;
  status: "active" | "suspended" | "deleting";
}

const isActive = (actor: Actor | null): actor is Actor =>
  actor !== null && actor.status === "active";

/** A version the actor may read right now, with what retrieval and citations need. */
export interface ReadableSource {
  versionId: string;
  documentId: string;
  title: string;
  status: string;
  pageCount: number | null;
  /** The version the Reader shows for this document; a newer one may have replaced it. */
  isCurrent: boolean;
  owned: boolean;
}

/**
 * The one statement of the document access rule (Section 12): a version is
 * readable by its owner while the document is active, or by any signed-in user
 * when an active published book revision references it. Versions the actor may
 * not read are simply absent, so callers cannot tell whether they exist.
 */
export async function readableSources(
  db: Executor,
  actor: Actor | null,
  versionIds: readonly string[],
): Promise<ReadableSource[]> {
  if (!isActive(actor) || versionIds.length === 0) return [];
  const rows = await db.execute<{
    version_id: string;
    document_id: string;
    title: string;
    status: string;
    page_count: number | null;
    is_current: boolean;
    owned: boolean;
  }>(sql`
    select
      v.id as version_id,
      v.document_id,
      coalesce(case when d.owner_id = ${actor.id} then d.title end, published.title, d.title) as title,
      v.status::text as status,
      v.page_count,
      (d.current_version_id = v.id or published.title is not null) as is_current,
      (d.owner_id = ${actor.id} and d.status = 'active' and d.deleted_at is null) as owned
    from document_versions v
    join documents d on d.id = v.document_id
    left join lateral (
      select br.title
      from book_revisions br
      join books b on b.published_revision_id = br.id
      where br.document_version_id = v.id
        and br.status = 'approved'
        and b.status = 'published'
        and b.deleted_at is null
      limit 1
    ) published on true
    where v.id in (${sql.join(
      versionIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      and (
        (d.owner_id = ${actor.id} and d.status = 'active' and d.deleted_at is null)
        or published.title is not null
      )`);
  return rows.map((row) => ({
    versionId: row.version_id,
    documentId: row.document_id,
    title: row.title,
    status: row.status,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    isCurrent: row.is_current === true,
    owned: row.owned === true,
  }));
}

export async function canReadDocumentVersion(
  db: Executor,
  actor: Actor | null,
  versionId: string,
): Promise<boolean> {
  return (await readableSources(db, actor, [versionId])).length > 0;
}

async function ownsRow(db: Executor, query: Parameters<typeof exists>[0]): Promise<boolean> {
  const [row] = await db.execute<{ owned: boolean }>(sql`select ${exists(query)} as owned`);
  return row?.owned === true;
}

export async function ownsDocument(db: Executor, actor: Actor | null, documentId: string) {
  if (!isActive(actor)) return false;
  return ownsRow(
    db,
    db
      .select({ one: sql`1` })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.ownerId, actor.id),
          isNull(documents.deletedAt),
        ),
      ),
  );
}

export async function ownsWorkspace(db: Executor, actor: Actor | null, workspaceId: string) {
  if (!isActive(actor)) return false;
  return ownsRow(
    db,
    db
      .select({ one: sql`1` })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, actor.id))),
  );
}

export async function ownsProject(db: Executor, actor: Actor | null, projectId: string) {
  if (!isActive(actor)) return false;
  return ownsRow(
    db,
    db
      .select({ one: sql`1` })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.ownerId, actor.id), isNull(projects.deletedAt)),
      ),
  );
}

export async function ownsCollection(db: Executor, actor: Actor | null, collectionId: string) {
  if (!isActive(actor)) return false;
  return ownsRow(
    db,
    db
      .select({ one: sql`1` })
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, actor.id))),
  );
}

/**
 * The same-owner invariant for `collection_items` (Section 12), which a foreign
 * key cannot express: both the collection and the saved item are the actor's.
 */
export async function canAddToCollection(
  db: Executor,
  actor: Actor | null,
  collectionId: string,
  libraryItemId: string,
): Promise<boolean> {
  if (!isActive(actor)) return false;
  const [row] = await db.execute<{ allowed: boolean }>(
    sql`select ${and(
      exists(
        db
          .select({ one: sql`1` })
          .from(collections)
          .where(and(eq(collections.id, collectionId), eq(collections.userId, actor.id))),
      ),
      exists(
        db
          .select({ one: sql`1` })
          .from(libraryItems)
          .where(and(eq(libraryItems.id, libraryItemId), eq(libraryItems.userId, actor.id))),
      ),
    )} as allowed`,
  );
  return row?.allowed === true;
}

/**
 * Workspace sources (Section 12): the workspace is the actor's and the version
 * is readable by them. Checked when a source is added and again on each use.
 */
export async function canUseWorkspaceSource(
  db: Executor,
  actor: Actor | null,
  workspaceId: string,
  versionId: string,
): Promise<boolean> {
  return (
    (await ownsWorkspace(db, actor, workspaceId)) &&
    (await canReadDocumentVersion(db, actor, versionId))
  );
}

/** Admin pages and admin mutations; it grants no private-content access (Section 4). */
export function isAdmin(user: { role: string; status: string } | null): boolean {
  return user !== null && user.status === "active" && user.role === "admin";
}

/** Publisher tools need the publisher role, granted after review; admin does not imply it. */
export function isPublisher(user: { role: string; status: string } | null): boolean {
  return user !== null && user.status === "active" && user.role === "publisher";
}
