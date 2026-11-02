import type { AnnotationAnchor, HighlightColor, ReadingProgressInput } from "@foliomind/contracts";
import { annotations, readingProgress, type Executor } from "@foliomind/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { canReadDocumentVersion, type Actor } from "../access";

/*
 * Reader state (blueprint Sections 11 and 12): highlights, notes, bookmarks and
 * reading progress belong to one user and one immutable document version.
 * Writing requires current read access to that version; changing or deleting
 * requires owning the annotation.
 */

export type AnnotationKind = "bookmark" | "highlight" | "note";

export interface AnnotationView {
  id: string;
  kind: AnnotationKind;
  pageNumber: number;
  anchor: AnnotationAnchor;
  body: string | null;
  color: HighlightColor | null;
  createdAt: Date;
}

const columns = {
  id: annotations.id,
  kind: annotations.kind,
  pageNumber: annotations.pageNumber,
  anchor: annotations.anchor,
  body: annotations.body,
  color: annotations.colorToken,
  createdAt: annotations.createdAt,
};

type Row = {
  id: string;
  kind: AnnotationKind;
  pageNumber: number;
  anchor: unknown;
  body: string | null;
  color: string | null;
  createdAt: Date;
};

const toView = (row: Row): AnnotationView => ({
  ...row,
  anchor: row.anchor as AnnotationAnchor,
  color: row.color as HighlightColor | null,
});

export async function listAnnotations(
  db: Executor,
  userId: string,
  versionId: string,
): Promise<AnnotationView[]> {
  const rows = await db
    .select(columns)
    .from(annotations)
    .where(and(eq(annotations.userId, userId), eq(annotations.documentVersionId, versionId)))
    .orderBy(asc(annotations.pageNumber), asc(annotations.createdAt));
  return rows.map(toView);
}

export async function createAnnotation(
  db: Executor,
  actor: Actor,
  input: {
    versionId: string;
    kind: "highlight" | "note";
    anchor: AnnotationAnchor;
    body?: string | undefined;
    color?: HighlightColor | undefined;
  },
): Promise<AnnotationView | null> {
  if (!(await canReadDocumentVersion(db, actor, input.versionId))) return null;
  const [row] = await db
    .insert(annotations)
    .values({
      userId: actor.id,
      documentVersionId: input.versionId,
      kind: input.kind,
      pageNumber: input.anchor.page,
      anchor: input.anchor,
      body: input.body ?? null,
      colorToken: input.color ?? null,
    })
    .returning(columns);
  return row ? toView(row) : null;
}

/** Edits the actor's own note text or highlight color. */
export async function updateAnnotation(
  db: Executor,
  actor: Actor,
  annotationId: string,
  input: { body?: string | undefined; color?: HighlightColor | undefined },
): Promise<AnnotationView | null> {
  if (actor.status !== "active") return null;
  const set: Partial<typeof annotations.$inferInsert> = {};
  if (input.body !== undefined) set.body = input.body;
  if (input.color !== undefined) set.colorToken = input.color;
  if (Object.keys(set).length === 0) return null;
  const [row] = await db
    .update(annotations)
    .set(set)
    .where(and(eq(annotations.id, annotationId), eq(annotations.userId, actor.id)))
    .returning(columns);
  return row ? toView(row) : null;
}

export async function deleteAnnotation(
  db: Executor,
  actor: Actor,
  annotationId: string,
): Promise<boolean> {
  if (actor.status !== "active") return false;
  const deleted = await db
    .delete(annotations)
    .where(and(eq(annotations.id, annotationId), eq(annotations.userId, actor.id)))
    .returning({ id: annotations.id });
  return deleted.length > 0;
}

/** One bookmark per page: adds it, or removes the existing one. */
export async function toggleBookmark(
  db: Executor,
  actor: Actor,
  input: { versionId: string; pageNumber: number },
): Promise<{ bookmarked: boolean; annotation: AnnotationView | null } | null> {
  if (!(await canReadDocumentVersion(db, actor, input.versionId))) return null;
  const removed = await db
    .delete(annotations)
    .where(
      and(
        eq(annotations.userId, actor.id),
        eq(annotations.documentVersionId, input.versionId),
        eq(annotations.kind, "bookmark"),
        eq(annotations.pageNumber, input.pageNumber),
      ),
    )
    .returning({ id: annotations.id });
  if (removed.length > 0) return { bookmarked: false, annotation: null };
  const [row] = await db
    .insert(annotations)
    .values({
      userId: actor.id,
      documentVersionId: input.versionId,
      kind: "bookmark",
      pageNumber: input.pageNumber,
      anchor: { page: input.pageNumber },
    })
    .returning(columns);
  return { bookmarked: true, annotation: row ? toView(row) : null };
}

export interface ReadingPosition {
  pageNumber: number;
  position: ReadingProgressInput["position"];
  lastReadAt: Date;
}

export async function getReadingProgress(
  db: Executor,
  userId: string,
  versionId: string,
): Promise<ReadingPosition | null> {
  const [row] = await db
    .select({
      pageNumber: readingProgress.pageNumber,
      position: readingProgress.position,
      lastReadAt: readingProgress.lastReadAt,
    })
    .from(readingProgress)
    .where(
      and(eq(readingProgress.userId, userId), eq(readingProgress.documentVersionId, versionId)),
    );
  return row ? { ...row, position: row.position as ReadingPosition["position"] } : null;
}

/** Upserts the actor's place in a version they can read. */
export async function saveReadingProgress(
  db: Executor,
  actor: Actor,
  input: { versionId: string; pageNumber: number; position: ReadingProgressInput["position"] },
): Promise<boolean> {
  if (!(await canReadDocumentVersion(db, actor, input.versionId))) return false;
  await db
    .insert(readingProgress)
    .values({
      userId: actor.id,
      documentVersionId: input.versionId,
      pageNumber: input.pageNumber,
      position: input.position,
    })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.documentVersionId],
      set: {
        pageNumber: input.pageNumber,
        position: input.position,
        lastReadAt: sql`now()`,
      },
    });
  return true;
}
