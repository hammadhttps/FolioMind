import { MAX_SOURCE_PAGES, MAX_SOURCE_PDF_BYTES } from "@foliomind/contracts";
import {
  activateVersion,
  assertJobCanContinue,
  chunksToEmbed,
  copyIndex,
  failJob,
  findReusableVersion,
  indexStats,
  jobErrorCodeFrom,
  JobFailure,
  JobStopped,
  loadIngestionTarget,
  loadPages,
  markImportIngestionFailed,
  markImportReady,
  markJobPhase,
  recordAiRun,
  saveChunks,
  saveEmbeddings,
  savePages,
  setVersionStatus,
  stopJob,
  updateJobProgress,
} from "@foliomind/domain";
import type { Inngest } from "inngest";
import {
  documentVersionCancelled,
  documentVersionUploaded,
  notificationCreated,
} from "../../events";
import { chunkPages, estimateTokens } from "../../ingestion/chunking";
import { withDownloadedFile } from "../../ingestion/files";
import { processPages, type PageHeading } from "../../ingestion/pages";
import { guarded, isStopped, type WorkerADeps } from "./shared";

/*
 * `ingest-document` (blueprint Section 8 "Ingestion" and Section 9): validate →
 * dedupe → extract pages → chunk → embed batch 1…n → verify → activate →
 * notify. Every step re-checks the job and document before writing, stores its
 * results in Postgres and returns only counts.
 */

/** Chunks per Jina request: about 30k tokens at the 900-token chunk ceiling. */
export const EMBED_BATCH_SIZE = 32;

export function createIngestDocumentFunction(inngest: Inngest, deps: WorkerADeps) {
  const { db, files, extract, jina } = deps;

  return inngest.createFunction(
    {
      id: "ingest-document",
      name: "Ingest document",
      triggers: [documentVersionUploaded],
      retries: 3,
      idempotency: "event.data.operationKey",
      concurrency: [{ limit: deps.concurrency.ingestion }, { key: "event.data.ownerId", limit: 1 }],
      cancelOn: [{ event: documentVersionCancelled, match: "data.jobId" }],
      onFailure: async ({ event, error, step }) => {
        const { jobId, versionId, documentId, ownerId } = event.data.event.data;
        const outcome = await step.run("record-failure", async () => {
          if (isStopped(error)) {
            await stopJob(db, jobId);
            return null;
          }
          const code = jobErrorCodeFrom(error);
          await setVersionStatus(db, versionId, code === "needs_ocr" ? "needs_ocr" : "failed");
          await markImportIngestionFailed(db, documentId, code);
          const failed = await failJob(db, jobId, code);
          deps.logger.warn({ jobId, versionId, code }, "ingestion failed");
          return failed ? { code } : null;
        });
        if (!outcome) return;
        const type = outcome.code === "needs_ocr" ? "document_needs_ocr" : "document_failed";
        await step.sendEvent("notify-failure", {
          id: `notify:${type}:${jobId}`,
          name: notificationCreated.name,
          data: { userId: ownerId, type, subjectId: documentId, operationKey: `${type}:${jobId}` },
        });
      },
    },
    async ({ event, step, runId, attempt }) => {
      const { versionId, jobId, documentId, ownerId } = event.data;
      const guard = () => assertJobCanContinue(db, jobId, documentId);
      const target = async () => {
        const row = await loadIngestionTarget(db, versionId);
        if (!row || row.documentId !== documentId || row.ownerId !== ownerId) {
          throw new JobStopped("missing");
        }
        return row;
      };

      // 1. Validate the stored file in the sandbox: signature, size, parseable, page count.
      const validated = await step.run("validate", () =>
        guarded(async () => {
          await guard();
          const version = await target();
          await markJobPhase(db, jobId, "validating", {
            run: { runId, eventId: event.id, attempt },
          });
          await setVersionStatus(db, versionId, "extracting");
          if (version.assetState !== "ready") throw new JobFailure("file_missing");
          if (version.bytes > MAX_SOURCE_PDF_BYTES) throw new JobFailure("file_too_large");
          return withDownloadedFile(
            files.url(version.fileKey),
            { maxBytes: MAX_SOURCE_PDF_BYTES, tempDir: deps.tempDir },
            async (file) => {
              const outcome = await extract(file.path, {
                mode: "validate",
                maxPages: MAX_SOURCE_PAGES,
              });
              if (!outcome.ok) throw new JobFailure(outcome.code);
              await setVersionStatus(db, versionId, "extracting", {
                sha256: file.sha256,
                pageCount: outcome.pageCount,
              });
              return { sha256: file.sha256, pageCount: outcome.pageCount };
            },
          );
        }),
      );

      // 2. Same file already indexed for this owner: reuse its pages, chunks and embeddings.
      const reused = await step.run("dedupe", () =>
        guarded(async () => {
          await guard();
          const version = await target();
          const from = await findReusableVersion(db, { ...version, sha256: validated.sha256 });
          if (!from) return null;
          const copied = await copyIndex(db, from, versionId);
          await setVersionStatus(db, versionId, "embedding", {
            extractionQuality: {
              ...(copied.quality as Record<string, unknown>),
              reusedIndex: true,
            },
          });
          await updateJobProgress(db, jobId, {
            pages: copied.pages,
            chunks: copied.chunks,
            embedded: copied.chunks,
          });
          return { pages: copied.pages, chunks: copied.chunks };
        }),
      );

      let expectedChunks = reused?.chunks ?? 0;
      if (!reused) {
        // 3. Page text, labels and quality; scanned or empty PDFs stop as needs_ocr.
        const extracted = await step.run("extract-pages", () =>
          guarded(async () => {
            await guard();
            const version = await target();
            await markJobPhase(db, jobId, "extracting");
            return withDownloadedFile(
              files.url(version.fileKey),
              { maxBytes: MAX_SOURCE_PDF_BYTES, tempDir: deps.tempDir },
              async (file) => {
                if (file.sha256 !== validated.sha256) throw new JobFailure("file_missing");
                const outcome = await extract(file.path, {
                  mode: "extract",
                  maxPages: MAX_SOURCE_PAGES,
                });
                if (!outcome.ok) throw new JobFailure(outcome.code);
                const { pages, quality } = processPages(outcome.pages);
                await savePages(
                  db,
                  versionId,
                  pages.map((page) => ({
                    pageNumber: page.pageNumber,
                    pageLabel: page.pageLabel,
                    text: page.text,
                    metadata: { headings: page.headings, ...page.stats },
                  })),
                );
                await setVersionStatus(
                  db,
                  versionId,
                  quality.needsOcr ? "needs_ocr" : "extracting",
                  {
                    pageCount: outcome.pageCount,
                    extractionQuality: { ...quality },
                  },
                );
                await updateJobProgress(db, jobId, { pages: pages.length });
                if (quality.needsOcr) throw new JobFailure("needs_ocr");
                return { pages: pages.length };
              },
            );
          }),
        );

        // 4–5. Section-aware chunks with page anchors.
        const chunked = await step.run("chunk", () =>
          guarded(async () => {
            await guard();
            await markJobPhase(db, jobId, "chunking");
            const pages = await loadPages(db, versionId);
            const chunks = chunkPages(
              pages.map((page) => ({
                pageNumber: page.pageNumber,
                text: page.text,
                headings: (page.metadata.headings as PageHeading[] | undefined) ?? [],
              })),
            );
            if (chunks.length === 0) {
              await setVersionStatus(db, versionId, "needs_ocr");
              throw new JobFailure("needs_ocr");
            }
            await saveChunks(db, versionId, chunks);
            await setVersionStatus(db, versionId, "embedding");
            await updateJobProgress(db, jobId, { chunks: chunks.length, embedded: 0 });
            return { pages: extracted.pages, chunks: chunks.length };
          }),
        );
        expectedChunks = chunked.chunks;

        // 6–7. One step per embedding batch, so finished batches are never re-billed.
        const batches = Math.ceil(chunked.chunks / EMBED_BATCH_SIZE);
        for (let batch = 0; batch < batches; batch += 1) {
          await step.run(`embed-batch-${batch + 1}`, () =>
            guarded(async () => {
              await guard();
              if (batch === 0) await markJobPhase(db, jobId, "embedding");
              const from = batch * EMBED_BATCH_SIZE;
              const rows = await chunksToEmbed(db, versionId, from, from + EMBED_BATCH_SIZE);
              if (rows.length > 0) {
                if (!jina) throw new JobFailure("provider_unavailable");
                const inputs = rows.map((row) =>
                  row.heading ? `${row.heading}\n\n${row.text}` : row.text,
                );
                const started = performance.now();
                const result = await jina.embed(inputs, { task: "retrieval.passage" });
                await saveEmbeddings(
                  db,
                  rows.map((row, index) => ({ id: row.id, embedding: result.embeddings[index]! })),
                );
                await recordAiRun(db, {
                  userId: ownerId,
                  jobId,
                  purpose: "ingest-embedding",
                  provider: "jina",
                  model: result.model,
                  inputTokens: result.usage.totalTokens,
                  latencyMs: performance.now() - started,
                  status: "succeeded",
                  metadata: {
                    versionId,
                    batch: batch + 1,
                    chunks: rows.length,
                    dimension: result.dimension,
                    // Calibrates the chunker's characters-per-token estimate.
                    estimatedTokens: inputs.reduce((sum, input) => sum + estimateTokens(input), 0),
                  },
                });
              }
              await updateJobProgress(db, jobId, {
                embedded: Math.min(chunked.chunks, from + EMBED_BATCH_SIZE),
              });
              return { embedded: rows.length };
            }),
          );
        }
      }

      // 8. Every chunk stored, embedded and searchable before the version can be ready.
      const stats = await step.run("verify", () =>
        guarded(async () => {
          await guard();
          await markJobPhase(db, jobId, "verifying");
          const counts = await indexStats(db, versionId);
          if (
            counts.chunks === 0 ||
            counts.chunks !== expectedChunks ||
            counts.embedded !== counts.chunks ||
            counts.searchable === 0
          ) {
            deps.logger.error(
              { jobId, versionId, ...counts, expectedChunks },
              "index verification failed",
            );
            throw new JobFailure("internal");
          }
          return counts;
        }),
      );

      // 9. Atomic activation; a cancelled job or deleted document changes nothing.
      await step.run("activate", () =>
        guarded(async () => {
          await activateVersion(db, {
            versionId,
            documentId,
            jobId,
            result: { pages: stats.pages, chunks: stats.chunks, reusedIndex: Boolean(reused) },
          });
          await markImportReady(db, documentId);
        }),
      );

      await step.sendEvent("notify", {
        id: `notify:document_ready:${versionId}`,
        name: notificationCreated.name,
        data: {
          userId: ownerId,
          type: "document_ready",
          subjectId: documentId,
          operationKey: `document_ready:${versionId}`,
        },
      });
      return { versionId, pages: stats.pages, chunks: stats.chunks };
    },
  );
}
