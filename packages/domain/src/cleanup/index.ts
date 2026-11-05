import {
  assets,
  documentChunks,
  documentPages,
  documents,
  documentVersions,
  messageCitations,
  uploadIntents,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

/*
 * Daily maintenance (blueprint Sections 9, 12 and 25), in bounded, idempotent
 * batches: expired upload intents, purging deleted documents' text and
 * embeddings, stored files waiting for deletion, and orphan sweeps. Citations
 * keep their page and title tombstones: `message_citations.chunk_id` is set to
 * null when a chunk goes, and versions are kept.
 */

/** Issued intents past their expiry become `expired`. */
export async function expireUploadIntents(
  db: Executor,
  { now = new Date(), limit = 1000 }: { now?: Date; limit?: number } = {},
): Promise<number> {
  const result = await db.execute(sql`
    update upload_intents set status = 'expired', updated_at = now()
    where id in (
      select id from upload_intents
      where status = 'issued' and expires_at < ${now.toISOString()}
      order by expires_at limit ${limit}
      for update skip locked)`);
  return result.count;
}

/**
 * Removes pages, chunks and embeddings of documents deleted by their owners
 * (access stopped at deletion), then marks the documents `deleted`. Their
 * files are queued as `deleting` assets for `filesToDelete`.
 */
export async function purgeDeletedDocuments(
  db: Database,
  { limit = 25 }: { limit?: number } = {},
): Promise<{ documents: number; chunks: number; pages: number }> {
  const batch = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.status, "deleting"))
    .orderBy(documents.deletedAt)
    .limit(limit);
  let chunks = 0;
  let pages = 0;
  for (const { id } of batch) {
    await db.transaction(async (tx) => {
      const versions = tx
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id));
      chunks += (
        await tx.delete(documentChunks).where(inArray(documentChunks.documentVersionId, versions))
      ).count;
      pages += (
        await tx.delete(documentPages).where(inArray(documentPages.documentVersionId, versions))
      ).count;
      // Citations keep their page and title; the source itself is gone for good.
      await tx
        .update(messageCitations)
        .set({ sourceAvailable: false })
        .where(inArray(messageCitations.sourceVersionId, versions));
      await tx
        .update(assets)
        .set({ state: "deleting", updatedAt: sql`now()` })
        .where(
          and(
            inArray(
              assets.id,
              tx
                .select({ id: documentVersions.assetId })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, id)),
            ),
            inArray(assets.state, ["pending", "ready"]),
          ),
        );
      await tx
        .update(documents)
        .set({ status: "deleted", updatedAt: sql`now()` })
        .where(and(eq(documents.id, id), eq(documents.status, "deleting")));
    });
  }
  return { documents: batch.length, chunks, pages };
}

/** Stored files waiting for deletion: deleted documents, replaced avatars, orphans. */
export async function filesToDelete(db: Executor, { limit = 100 } = {}): Promise<string[]> {
  const rows = await db
    .select({ fileKey: assets.fileKey })
    .from(assets)
    .where(eq(assets.state, "deleting"))
    .orderBy(assets.updatedAt)
    .limit(limit);
  return rows.map((row) => row.fileKey);
}

/**
 * Orphan sweep part one (Section 25): `pending` assets older than a day never
 * completed, so they are queued for deletion.
 */
export async function queueStalePendingAssets(
  db: Executor,
  { now = new Date(), limit = 500 }: { now?: Date; limit?: number } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    update assets set state = 'deleting', updated_at = now()
    where id in (
      select id from assets where state = 'pending' and created_at < ${cutoff.toISOString()}
      order by created_at limit ${limit} for update skip locked)`);
  return result.count;
}

/** Orphan sweep part two: which of these stored file keys no asset row knows. */
export async function unknownFileKeys(db: Executor, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const known = await db
    .select({ fileKey: assets.fileKey })
    .from(assets)
    .where(inArray(assets.fileKey, [...keys]));
  const knownSet = new Set(known.map((row) => row.fileKey));
  return keys.filter((key) => !knownSet.has(key));
}

/** Old intents are kept only for their audit value; a year later they go. */
export async function purgeOldIntents(
  db: Executor,
  { now = new Date() }: { now?: Date } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(uploadIntents)
    .where(and(inArray(uploadIntents.status, ["expired"]), lt(uploadIntents.createdAt, cutoff)))
    .returning({ id: uploadIntents.id });
  return deleted.length;
}
