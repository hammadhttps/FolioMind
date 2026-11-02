import { collectionItems, collections, type Executor } from "@foliomind/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { canAddToCollection, type Actor } from "../access";

/*
 * Collections (blueprint Sections 11 and 28): named groups of the user's own
 * library items. Deleting a collection keeps its documents. Names are unique
 * per user, case-insensitively (a unique index backs the check).
 */

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

export type CollectionResult =
  { ok: true; id: string } | { ok: false; code: "name_taken" | "not_found" | "forbidden" };

const UNIQUE_VIOLATION = "23505";

function isNameTaken(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause ?? error;
  return (cause as { code?: string })?.code === UNIQUE_VIOLATION;
}

export async function listCollections(db: Executor, userId: string): Promise<CollectionSummary[]> {
  return db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      itemCount:
        sql<number>`(select count(*)::int from ${collectionItems} where ${collectionItems.collectionId} = ${collections.id})`.mapWith(
          Number,
        ),
    })
    .from(collections)
    .where(eq(collections.userId, userId))
    .orderBy(asc(sql`lower(${collections.name})`));
}

export async function createCollection(
  db: Executor,
  actor: Actor,
  input: { name: string; description?: string | undefined },
): Promise<CollectionResult> {
  if (actor.status !== "active") return { ok: false, code: "forbidden" };
  try {
    const [row] = await db
      .insert(collections)
      .values({ userId: actor.id, name: input.name, description: input.description ?? null })
      .returning({ id: collections.id });
    return row ? { ok: true, id: row.id } : { ok: false, code: "not_found" };
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, code: "name_taken" };
    throw error;
  }
}

export async function updateCollection(
  db: Executor,
  actor: Actor,
  collectionId: string,
  input: { name: string; description?: string | undefined },
): Promise<CollectionResult> {
  if (actor.status !== "active") return { ok: false, code: "forbidden" };
  try {
    const [row] = await db
      .update(collections)
      .set({ name: input.name, description: input.description ?? null })
      .where(and(eq(collections.id, collectionId), eq(collections.userId, actor.id)))
      .returning({ id: collections.id });
    return row ? { ok: true, id: row.id } : { ok: false, code: "not_found" };
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, code: "name_taken" };
    throw error;
  }
}

/** Removes the collection and its memberships; the documents stay in the library. */
export async function deleteCollection(
  db: Executor,
  actor: Actor,
  collectionId: string,
): Promise<boolean> {
  if (actor.status !== "active") return false;
  const deleted = await db
    .delete(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, actor.id)))
    .returning({ id: collections.id });
  return deleted.length > 0;
}

/** Adds or removes a library item; both must belong to the actor (same-owner invariant). */
export async function setCollectionMembership(
  db: Executor,
  actor: Actor,
  input: { collectionId: string; libraryItemId: string; member: boolean },
): Promise<boolean> {
  if (!(await canAddToCollection(db, actor, input.collectionId, input.libraryItemId))) return false;
  if (input.member) {
    await db
      .insert(collectionItems)
      .values({ collectionId: input.collectionId, libraryItemId: input.libraryItemId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(collectionItems)
      .where(
        and(
          eq(collectionItems.collectionId, input.collectionId),
          eq(collectionItems.libraryItemId, input.libraryItemId),
        ),
      );
  }
  return true;
}
