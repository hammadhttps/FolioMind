import { createHash, randomUUID } from "node:crypto";
import {
  DAILY_SOURCE_ADMISSIONS,
  EVENT_NAMES,
  INDEX_VERSION,
  MAX_SOURCE_PDF_BYTES,
} from "@foliomind/contracts";
import {
  assets,
  documents,
  documentVersions,
  jobs,
  libraryItems,
  urlImports,
  users,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { PDF_MIME_TYPE, ingestOperationKey, type EmbeddingConfig } from "../documents";
import { currentEntitlement } from "../entitlements";
import { JobStopped } from "../jobs";
import { enqueue } from "../outbox";
import { commit, release, reserve, ownedSourceCount, storageBytesUsed } from "../usage";

/*
 * Web article import (blueprint Section 27). The request records the import,
 * a placeholder document (so My Library shows a Processing card at once), the
 * job and the outbox event in one transaction, after reserving one import from
 * the monthly allowance (Section 10). Worker A's import-url turns the page into
 * a PDF snapshot and hands it to the same ingestion as an upload.
 */

export const importOperationKey = (importId: string) => `import-url:${importId}`;

/** Imports can wait in the queue; their reservation outlives the default hour. */
const IMPORT_RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;

export type ImportRefusal =
  | "account_inactive"
  | "file_limit"
  | "storage_limit"
  | "daily_limit"
  | "quota_exceeded"
  | "not_found"
  | "busy";

export type ImportRequestResult =
  | { ok: true; importId: string; documentId: string; jobId: string; eventKey: string }
  | { ok: false; code: ImportRefusal };

class ImportRefused extends Error {
  constructor(readonly code: ImportRefusal) {
    super(code);
  }
}

const urlHash = (url: string) => createHash("sha256").update(url).digest("hex");

/** A readable placeholder until the article's own title arrives. */
function placeholderTitle(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  const last = decodeURIComponent(path.split("/").pop() ?? "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const host = url.hostname.replace(/^www\./, "");
  return (last ? `${last} (${host})` : host).slice(0, 200);
}

async function dailyAdmissions(db: Executor, userId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(urlImports)
    .where(and(eq(urlImports.userId, userId), gte(urlImports.createdAt, since)));
  return row?.count ?? 0;
}

async function createImport(
  db: Database,
  input: {
    userId: string;
    url: URL;
    documentId?: string;
    now: Date;
  },
): Promise<ImportRequestResult> {
  const importId = randomUUID();
  const operationKey = importOperationKey(importId);
  const reserved = await reserve(db, {
    userId: input.userId,
    metric: "url_imports",
    quantity: 1,
    operationKey,
    expiresAt: new Date(input.now.getTime() + IMPORT_RESERVATION_TTL_MS),
    now: input.now,
  });
  if (!reserved.ok) return { ok: false, code: "quota_exceeded" };

  try {
    return await db.transaction(async (tx) => {
      // Serializes this user's admissions, as upload completion does.
      const [user] = await tx
        .select({ status: users.status, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");
      if (!user || user.status !== "active" || user.deletedAt) {
        throw new ImportRefused("account_inactive");
      }
      const { planCode, limits } = await currentEntitlement(tx, input.userId, input.now);
      if ((await storageBytesUsed(tx, input.userId)) >= limits.storageBytes) {
        throw new ImportRefused("storage_limit");
      }
      if (
        (await dailyAdmissions(tx, input.userId, input.now)) >= DAILY_SOURCE_ADMISSIONS[planCode]
      ) {
        throw new ImportRefused("daily_limit");
      }

      let documentId = input.documentId;
      if (documentId) {
        const [busy] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.ownerId, input.userId),
              eq(jobs.kind, "import-url"),
              eq(jobs.targetId, documentId),
              inArray(jobs.status, ["queued", "running"]),
            ),
          );
        if (busy) throw new ImportRefused("busy");
      } else {
        // A new import is one more owned source (Section 10).
        if ((await ownedSourceCount(tx, input.userId)) >= limits.ownedSourcePdfs) {
          throw new ImportRefused("file_limit");
        }
        const [document] = await tx
          .insert(documents)
          .values({
            ownerId: input.userId,
            title: placeholderTitle(input.url),
            sourceKind: "url_import",
            sourceUrl: input.url.toString(),
          })
          .returning({ id: documents.id });
        if (!document) throw new Error("Import document was not created");
        documentId = document.id;
        await tx.insert(libraryItems).values({ userId: input.userId, documentId });
      }

      const [job] = await tx
        .insert(jobs)
        .values({ ownerId: input.userId, kind: "import-url", targetId: documentId, operationKey })
        .returning({ id: jobs.id });
      if (!job) throw new Error("Import job was not created");
      await tx.insert(urlImports).values({
        id: importId,
        userId: input.userId,
        sourceUrl: input.url.toString(),
        urlHash: urlHash(input.url.toString()),
        rightsConfirmedAt: input.now,
        documentId,
        jobId: job.id,
      });
      await enqueue(tx, {
        key: operationKey,
        name: EVENT_NAMES.documentUrlImportRequested,
        data: { importId, documentId, ownerId: input.userId, jobId: job.id, operationKey },
      });
      return { ok: true, importId, documentId, jobId: job.id, eventKey: operationKey } as const;
    });
  } catch (error) {
    await release(db, operationKey);
    if (error instanceof ImportRefused) return { ok: false, code: error.code };
    throw error;
  }
}

/** `POST /api/imports/url`: the URL has already passed `checkImportUrl` on the server. */
export function requestUrlImport(
  db: Database,
  input: { userId: string; url: URL; now?: Date },
): Promise<ImportRequestResult> {
  return createImport(db, { userId: input.userId, url: input.url, now: input.now ?? new Date() });
}

/**
 * Re-import (Section 27 step 8), and retry of a failed import: a new snapshot
 * of the same address becomes a new version of the same document.
 */
export async function requestReimport(
  db: Database,
  input: { userId: string; documentId: string; now?: Date },
): Promise<ImportRequestResult> {
  const [document] = await db
    .select({ sourceUrl: documents.sourceUrl })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.ownerId, input.userId),
        eq(documents.status, "active"),
        eq(documents.sourceKind, "url_import"),
      ),
    );
  if (!document?.sourceUrl) return { ok: false, code: "not_found" };
  return createImport(db, {
    userId: input.userId,
    url: new URL(document.sourceUrl),
    documentId: input.documentId,
    now: input.now ?? new Date(),
  });
}

/* --- Worker side ------------------------------------------------------------ */

export interface ImportTarget {
  importId: string;
  userId: string;
  sourceUrl: string;
  status: string;
  documentId: string;
  documentTitle: string;
  documentStatus: string;
  fetchedTitle: string | null;
  wordCount: number | null;
}

export async function loadImport(db: Executor, importId: string): Promise<ImportTarget | null> {
  const [row] = await db
    .select({
      importId: urlImports.id,
      userId: urlImports.userId,
      sourceUrl: urlImports.sourceUrl,
      status: urlImports.status,
      documentId: documents.id,
      documentTitle: documents.title,
      documentStatus: documents.status,
      fetchedTitle: urlImports.fetchedTitle,
      wordCount: urlImports.wordCount,
    })
    .from(urlImports)
    .innerJoin(documents, eq(documents.id, urlImports.documentId))
    .where(eq(urlImports.id, importId));
  return row ?? null;
}

type ImportStatus = (typeof urlImports.status.enumValues)[number];

export async function setImportStatus(
  db: Executor,
  importId: string,
  status: ImportStatus,
  extra: { fetchedTitle?: string; wordCount?: number; safeErrorCode?: string | null } = {},
): Promise<void> {
  await db
    .update(urlImports)
    .set({ status, ...extra, updatedAt: sql`now()` })
    .where(and(eq(urlImports.id, importId), sql`${urlImports.status} not in ('ready', 'failed')`));
}

/** Marks a failed import and returns its reservation (onFailure and refusals). */
export async function failImport(db: Database, importId: string, code: string): Promise<void> {
  await db
    .update(urlImports)
    .set({ status: "failed", safeErrorCode: code, updatedAt: sql`now()` })
    .where(and(eq(urlImports.id, importId), sql`${urlImports.status} <> 'ready'`));
  await release(db, importOperationKey(importId));
}

/** The stored snapshot, if an earlier attempt already uploaded it (Section 25: look up by customId). */
export async function existingSnapshot(
  db: Executor,
  customId: string,
): Promise<{ fileKey: string; bytes: number } | null> {
  const [asset] = await db
    .select({ fileKey: assets.fileKey, bytes: assets.bytes })
    .from(assets)
    .where(eq(assets.customId, customId));
  return asset ?? null;
}

export const snapshotCustomId = (importId: string) => `snapshot:${importId}`;

/**
 * Section 27 step 7: the uploaded snapshot becomes a new queued version with an
 * ingestion job and outbox event, in one transaction. A first import also
 * takes the article's title and becomes the document's current version; a
 * re-import's version becomes current only when its ingestion is ready.
 * Returns the outbox key to deliver after commit.
 */
export async function createSnapshotVersion(
  db: Database,
  input: {
    importId: string;
    jobId: string;
    userId: string;
    documentId: string;
    title: string;
    wordCount: number;
    file: { key: string; size: number };
    acl: "public" | "private";
    embedding: EmbeddingConfig;
  },
): Promise<{ versionId: string; eventKey: string } | { refused: "storage_limit" }> {
  const customId = snapshotCustomId(input.importId);
  return db.transaction(async (tx) => {
    const [document] = await tx
      .select({ status: documents.status, currentVersionId: documents.currentVersionId })
      .from(documents)
      .where(and(eq(documents.id, input.documentId), eq(documents.ownerId, input.userId)))
      .for("update");
    if (!document || document.status !== "active") throw new JobStopped("deleted");
    const [job] = await tx
      .select({ status: jobs.status, cancelRequested: jobs.cancelRequested })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .for("update");
    if (!job || job.cancelRequested || !["queued", "running"].includes(job.status)) {
      throw new JobStopped("cancelled");
    }

    let [asset] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.customId, customId));
    if (!asset) {
      const { limits } = await currentEntitlement(tx, input.userId);
      if (
        input.file.size > MAX_SOURCE_PDF_BYTES ||
        (await storageBytesUsed(tx, input.userId)) + input.file.size > limits.storageBytes
      ) {
        return { refused: "storage_limit" } as const;
      }
      [asset] = await tx
        .insert(assets)
        .values({
          ownerId: input.userId,
          fileKey: input.file.key,
          customId,
          fileRoute: "webSnapshot",
          acl: input.acl,
          purpose: "source",
          bytes: input.file.size,
          mimeType: PDF_MIME_TYPE,
          state: "ready",
        })
        .returning({ id: assets.id });
    }
    if (!asset) throw new Error("Snapshot asset was not created");

    const [existing] = await tx
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(eq(documentVersions.assetId, asset.id));
    let versionId = existing?.id;
    if (!versionId) {
      const [next] = await tx.execute<{ no: number }>(sql`
        select coalesce(max(version_no), 0)::int + 1 as no
        from document_versions where document_id = ${input.documentId}`);
      const [version] = await tx
        .insert(documentVersions)
        .values({
          documentId: input.documentId,
          versionNo: Number(next?.no ?? 1),
          assetId: asset.id,
          status: "queued",
          indexVersion: INDEX_VERSION,
          embeddingModel: input.embedding.model,
          embeddingDimension: input.embedding.dimension,
        })
        .returning({ id: documentVersions.id });
      if (!version) throw new Error("Snapshot version was not created");
      versionId = version.id;
    }

    if (!document.currentVersionId) {
      await tx
        .update(documents)
        .set({ currentVersionId: versionId, title: input.title, updatedAt: sql`now()` })
        .where(eq(documents.id, input.documentId));
    }

    const operationKey = ingestOperationKey(versionId);
    const [ingestJob] = await tx
      .insert(jobs)
      .values({
        ownerId: input.userId,
        kind: "ingest-document",
        targetId: versionId,
        operationKey,
      })
      .onConflictDoNothing({ target: jobs.operationKey })
      .returning({ id: jobs.id });
    const ingestJobId =
      ingestJob?.id ??
      (await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.operationKey, operationKey)))[0]
        ?.id;
    if (!ingestJobId) throw new Error("Ingestion job was not created");
    await enqueue(tx, {
      key: operationKey,
      name: EVENT_NAMES.documentVersionUploaded,
      data: {
        documentId: input.documentId,
        versionId,
        ownerId: input.userId,
        jobId: ingestJobId,
        operationKey,
      },
    });

    await tx
      .update(urlImports)
      .set({
        status: "ingesting",
        fetchedTitle: input.title,
        wordCount: input.wordCount,
        updatedAt: sql`now()`,
      })
      .where(eq(urlImports.id, input.importId));
    await tx
      .update(jobs)
      .set({
        status: "succeeded",
        phase: "done",
        result: { versionId, ingestJobId },
        updatedAt: sql`now()`,
      })
      .where(eq(jobs.id, input.jobId));
    return { versionId, eventKey: operationKey };
  });
}

/** The import's usage counts once its snapshot exists (Section 10). */
export async function commitImportUsage(db: Database, importId: string): Promise<void> {
  await commit(db, importOperationKey(importId));
}

/** An imported version finished ingesting: its import is ready too. */
export async function markImportReady(db: Executor, documentId: string): Promise<void> {
  await db
    .update(urlImports)
    .set({ status: "ready", updatedAt: sql`now()` })
    .where(and(eq(urlImports.documentId, documentId), eq(urlImports.status, "ingesting")));
}

/** The snapshot of an import could not be ingested: the import is failed too. */
export async function markImportIngestionFailed(
  db: Executor,
  documentId: string,
  code: string,
): Promise<void> {
  await db
    .update(urlImports)
    .set({ status: "failed", safeErrorCode: code, updatedAt: sql`now()` })
    .where(and(eq(urlImports.documentId, documentId), eq(urlImports.status, "ingesting")));
}
