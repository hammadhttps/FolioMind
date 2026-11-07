import {
  aiRuns,
  assets,
  documentChunks,
  documentPages,
  documents,
  documentVersions,
  jobs,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, asc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { JobStopped } from "../jobs";

/*
 * Ingestion storage (blueprint Section 8 steps 2–9, Section 12). Each Inngest
 * step writes its results here and returns only IDs and counts. Writes for a
 * version replace what an earlier attempt of the same step left behind, so a
 * retried step never duplicates pages or chunks.
 */

export interface IngestionTarget {
  versionId: string;
  documentId: string;
  ownerId: string;
  versionNo: number;
  status: string;
  sha256: string | null;
  indexVersion: string;
  embeddingModel: string;
  embeddingDimension: number;
  documentStatus: string;
  currentVersionId: string | null;
  fileKey: string;
  assetState: string;
  bytes: number;
}

export async function loadIngestionTarget(
  db: Executor,
  versionId: string,
): Promise<IngestionTarget | null> {
  const [row] = await db
    .select({
      versionId: documentVersions.id,
      documentId: documentVersions.documentId,
      ownerId: documents.ownerId,
      versionNo: documentVersions.versionNo,
      status: documentVersions.status,
      sha256: documentVersions.sha256,
      indexVersion: documentVersions.indexVersion,
      embeddingModel: documentVersions.embeddingModel,
      embeddingDimension: documentVersions.embeddingDimension,
      documentStatus: documents.status,
      currentVersionId: documents.currentVersionId,
      fileKey: assets.fileKey,
      assetState: assets.state,
      bytes: assets.bytes,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(assets, eq(assets.id, documentVersions.assetId))
    .where(eq(documentVersions.id, versionId));
  return row ?? null;
}

type VersionStatus = (typeof documentVersions.status.enumValues)[number];

/** Moves a version through processing states; a ready version is never moved back. */
export async function setVersionStatus(
  db: Executor,
  versionId: string,
  status: VersionStatus,
  extra: { sha256?: string; pageCount?: number; extractionQuality?: Record<string, unknown> } = {},
): Promise<void> {
  await db
    .update(documentVersions)
    .set({ status, ...extra, updatedAt: sql`now()` })
    .where(and(eq(documentVersions.id, versionId), ne(documentVersions.status, "ready")));
}

/**
 * Section 8 step 2: an identical file the same owner already indexed with the
 * same index settings. Only the owner's own active documents are considered,
 * so nothing reveals whether another user uploaded the same file.
 */
export async function findReusableVersion(
  db: Executor,
  target: Pick<
    IngestionTarget,
    "versionId" | "ownerId" | "indexVersion" | "embeddingModel" | "embeddingDimension"
  > & { sha256: string },
): Promise<string | null> {
  const [row] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documents.ownerId, target.ownerId),
        eq(documents.status, "active"),
        eq(documentVersions.sha256, target.sha256),
        eq(documentVersions.status, "ready"),
        eq(documentVersions.indexVersion, target.indexVersion),
        eq(documentVersions.embeddingModel, target.embeddingModel),
        eq(documentVersions.embeddingDimension, target.embeddingDimension),
        ne(documentVersions.id, target.versionId),
      ),
    )
    .orderBy(asc(documentVersions.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Copies another version's pages, chunks and embeddings (no new embedding calls). */
export async function copyIndex(
  db: Database,
  fromVersionId: string,
  toVersionId: string,
): Promise<{ pages: number; chunks: number; pageCount: number | null; quality: unknown }> {
  return db.transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentVersionId, toVersionId));
    await tx.delete(documentPages).where(eq(documentPages.documentVersionId, toVersionId));
    const pages = await tx.execute(sql`
      insert into document_pages (document_version_id, page_number, page_label, text, extraction_metadata)
      select ${toVersionId}, page_number, page_label, text, extraction_metadata
      from document_pages where document_version_id = ${fromVersionId}`);
    const chunks = await tx.execute(sql`
      insert into document_chunks (document_version_id, chunk_index, page_start, page_end, heading,
        text, char_offsets, token_count, content_hash, embedding)
      select ${toVersionId}, chunk_index, page_start, page_end, heading, text, char_offsets,
        token_count, content_hash, embedding
      from document_chunks where document_version_id = ${fromVersionId}`);
    const [source] = await tx
      .select({
        pageCount: documentVersions.pageCount,
        quality: documentVersions.extractionQuality,
      })
      .from(documentVersions)
      .where(eq(documentVersions.id, fromVersionId));
    return {
      pages: pages.count,
      chunks: chunks.count,
      pageCount: source?.pageCount ?? null,
      quality: source?.quality ?? {},
    };
  });
}

export interface PageRecord {
  pageNumber: number;
  pageLabel: string | null;
  text: string;
  metadata: Record<string, unknown>;
}

/** Replaces the version's pages (Section 8 step 3). */
export async function savePages(
  db: Database,
  versionId: string,
  pages: readonly PageRecord[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentVersionId, versionId));
    await tx.delete(documentPages).where(eq(documentPages.documentVersionId, versionId));
    for (let start = 0; start < pages.length; start += 50) {
      await tx.insert(documentPages).values(
        pages.slice(start, start + 50).map((page) => ({
          documentVersionId: versionId,
          pageNumber: page.pageNumber,
          pageLabel: page.pageLabel,
          text: page.text,
          extractionMetadata: page.metadata,
        })),
      );
    }
  });
}

export async function loadPages(db: Executor, versionId: string): Promise<PageRecord[]> {
  const rows = await db
    .select()
    .from(documentPages)
    .where(eq(documentPages.documentVersionId, versionId))
    .orderBy(asc(documentPages.pageNumber));
  return rows.map((row) => ({
    pageNumber: row.pageNumber,
    pageLabel: row.pageLabel,
    text: row.text,
    metadata: row.extractionMetadata as Record<string, unknown>,
  }));
}

export interface ChunkRecord {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  text: string;
  charOffsets: Record<string, unknown>;
  tokenCount: number;
  contentHash: string;
}

/** Replaces the version's chunks (Section 8 step 5); embeddings are added per batch. */
export async function saveChunks(
  db: Database,
  versionId: string,
  chunks: readonly ChunkRecord[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentVersionId, versionId));
    for (let start = 0; start < chunks.length; start += 100) {
      await tx
        .insert(documentChunks)
        .values(
          chunks
            .slice(start, start + 100)
            .map((chunk) => ({ documentVersionId: versionId, ...chunk })),
        );
    }
  });
}

/** Chunks in `[from, to)` that still need an embedding (a resumed batch skips the rest). */
export async function chunksToEmbed(
  db: Executor,
  versionId: string,
  from: number,
  to: number,
): Promise<{ id: string; text: string; heading: string | null }[]> {
  return db
    .select({ id: documentChunks.id, text: documentChunks.text, heading: documentChunks.heading })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.documentVersionId, versionId),
        gte(documentChunks.chunkIndex, from),
        lt(documentChunks.chunkIndex, to),
        isNull(documentChunks.embedding),
      ),
    )
    .orderBy(asc(documentChunks.chunkIndex));
}

export async function saveEmbeddings(
  db: Database,
  rows: readonly { id: string; embedding: number[] }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(documentChunks)
        .set({ embedding: row.embedding })
        .where(eq(documentChunks.id, row.id));
    }
  });
}

export interface IndexStats {
  pages: number;
  chunks: number;
  embedded: number;
  searchable: number;
}

/** Section 8 step 8: what verification checks before a version may become ready. */
export async function indexStats(db: Executor, versionId: string): Promise<IndexStats> {
  const [row] = await db.execute<{
    pages: number;
    chunks: number;
    embedded: number;
    searchable: number;
  }>(sql`
    select
      (select count(*)::int from document_pages where document_version_id = ${versionId}) as pages,
      count(*)::int as chunks,
      count(embedding)::int as embedded,
      count(*) filter (where search_vector is not null and search_vector <> ''::tsvector)::int as searchable
    from document_chunks where document_version_id = ${versionId}`);
  return {
    pages: Number(row?.pages ?? 0),
    chunks: Number(row?.chunks ?? 0),
    embedded: Number(row?.embedded ?? 0),
    searchable: Number(row?.searchable ?? 0),
  };
}

/**
 * Section 8 step 9: in one transaction the version becomes ready, the document
 * points at it and the job succeeds. If the document was deleted or the job
 * cancelled meanwhile, nothing changes and `JobStopped` is thrown, so a
 * cancelled or deleted document is never resurrected.
 */
export async function activateVersion(
  db: Database,
  input: { versionId: string; documentId: string; jobId: string; result: Record<string, unknown> },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [document] = await tx
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, input.documentId))
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
    await tx
      .update(documentVersions)
      .set({ status: "ready", updatedAt: sql`now()` })
      .where(eq(documentVersions.id, input.versionId));
    await tx
      .update(documents)
      .set({ currentVersionId: input.versionId, updatedAt: sql`now()` })
      .where(eq(documents.id, input.documentId));
    await tx
      .update(jobs)
      .set({
        status: "succeeded",
        phase: "done",
        safeErrorCode: null,
        result: input.result,
        updatedAt: sql`now()`,
      })
      .where(eq(jobs.id, input.jobId));
  });
}

/** Records provider usage without any document text (Section 8 step 7, Section 12). */
export async function recordAiRun(
  db: Executor,
  run: {
    userId: string;
    jobId: string | null;
    purpose: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens?: number;
    estimatedCost?: number;
    latencyMs: number;
    status: "succeeded" | "failed";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(aiRuns).values({
    userId: run.userId,
    jobId: run.jobId,
    purpose: run.purpose,
    provider: run.provider,
    model: run.model,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens ?? 0,
    ...(run.estimatedCost !== undefined ? { estimatedCost: run.estimatedCost.toFixed(8) } : {}),
    latencyMs: Math.max(0, Math.round(run.latencyMs)),
    status: run.status,
    retrievalMetadata: run.metadata ?? {},
  });
}
