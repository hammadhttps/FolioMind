import {
  bookRevisions,
  books,
  collections,
  documents,
  documentVersions,
  libraryItems,
  projects,
  workspaces,
  type Executor,
} from "@foliomind/db";
import { and, eq, exists, isNull, or, sql } from "drizzle-orm";

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

/**
 * A document version is readable by its owner while the document is active, or
 * by any signed-in user when an active published book revision references it.
 */
export async function canReadDocumentVersion(
  db: Executor,
  actor: Actor | null,
  versionId: string,
): Promise<boolean> {
  if (!isActive(actor)) return false;

  const owned = db
    .select({ one: sql`1` })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documents.ownerId, actor.id),
        eq(documents.status, "active"),
        isNull(documents.deletedAt),
      ),
    );
  const published = db
    .select({ one: sql`1` })
    .from(bookRevisions)
    .innerJoin(books, eq(books.publishedRevisionId, bookRevisions.id))
    .where(
      and(
        eq(bookRevisions.documentVersionId, versionId),
        eq(bookRevisions.status, "approved"),
        eq(books.status, "published"),
        isNull(books.deletedAt),
      ),
    );
  const [row] = await db.execute<{ allowed: boolean }>(
    sql`select ${or(exists(owned), exists(published))} as allowed`,
  );
  return row?.allowed === true;
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
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, actor.id))),
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
