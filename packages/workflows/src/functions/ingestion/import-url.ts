import {
  checkImportUrl,
  countWords,
  MAX_IMPORT_MARKDOWN_BYTES,
  MAX_IMPORT_WORDS,
  MAX_SOURCE_PDF_BYTES,
  MIN_IMPORT_WORDS,
  ProviderError,
} from "@foliomind/contracts";
import {
  assertJobCanContinue,
  commitImportUsage,
  createSnapshotVersion,
  deliverPending,
  failImport,
  failJob,
  jobErrorCodeFrom,
  JobFailure,
  JobStopped,
  loadImport,
  markJobPhase,
  recordAiRun,
  setImportStatus,
  snapshotCustomId,
  stopJob,
} from "@foliomind/domain";
import {
  markdownToSafeHtml,
  renderHtmlToPdf,
  webSnapshotHeaderFooter,
  webSnapshotHtml,
} from "@foliomind/pdf";
import type { Inngest } from "inngest";
import {
  documentUrlImportRequested,
  documentVersionCancelled,
  notificationCreated,
} from "../../events";
import { guarded, isStopped, type WorkerADeps } from "./shared";

/*
 * `import-url` (blueprint Sections 9 and 27): check URL → Jina Reader fetch →
 * sanitize → Browserless snapshot → upload → create the version and emit
 * `document/version.uploaded`. Fetching, sanitizing, rendering and uploading
 * share one step so the article's text never enters Inngest's run state; a
 * retry first looks for a snapshot an earlier attempt already stored.
 */

/** Section 26: input HTML is capped at 5 MB. */
const MAX_SNAPSHOT_HTML_BYTES = 5 * 1024 * 1024;

const cleanTitle = (value: string, fallback: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || fallback;

export function createImportUrlFunction(inngest: Inngest, deps: WorkerADeps) {
  const { db, files, jina } = deps;

  return inngest.createFunction(
    {
      id: "import-url",
      name: "Import web article",
      triggers: [documentUrlImportRequested],
      retries: 3,
      idempotency: "event.data.operationKey",
      concurrency: [{ limit: deps.concurrency.imports }, { key: "event.data.ownerId", limit: 1 }],
      cancelOn: [{ event: documentVersionCancelled, match: "data.jobId" }],
      onFailure: async ({ event, error, step }) => {
        const { jobId, importId, documentId, ownerId } = event.data.event.data;
        const failed = await step.run("record-failure", async () => {
          if (isStopped(error)) {
            await stopJob(db, jobId);
            await failImport(db, importId, "cancelled");
            return false;
          }
          const code = jobErrorCodeFrom(error);
          await failImport(db, importId, code);
          deps.logger.warn({ jobId, importId, code }, "import failed");
          return failJob(db, jobId, code);
        });
        if (!failed) return;
        await step.sendEvent("notify-failure", {
          id: `notify:import_failed:${jobId}`,
          name: notificationCreated.name,
          data: {
            userId: ownerId,
            type: "import_failed",
            subjectId: documentId,
            operationKey: `import_failed:${jobId}`,
          },
        });
      },
    },
    async ({ event, step, runId, attempt }) => {
      const { importId, documentId, ownerId, jobId } = event.data;
      const guard = () => assertJobCanContinue(db, jobId, documentId);
      const loadTarget = async () => {
        const target = await loadImport(db, importId);
        if (!target || target.documentId !== documentId || target.userId !== ownerId) {
          throw new JobStopped("missing");
        }
        return target;
      };

      // 1. The server already checked the address; check again before any provider call.
      const sourceUrl = await step.run("check-url", () =>
        guarded(async () => {
          await guard();
          const target = await loadTarget();
          await markJobPhase(db, jobId, "fetching", {
            run: { runId, eventId: event.id, attempt },
          });
          const checked = checkImportUrl(target.sourceUrl, deps.ownHosts);
          if (!checked.ok) throw new JobFailure("import_failed");
          return checked.url.toString();
        }),
      );

      // 2–5. Jina Reader → sanitize → Web Snapshot → Browserless → private upload.
      const snapshot = await step.run("snapshot", () =>
        guarded(async () => {
          await guard();
          const customId = snapshotCustomId(importId);
          const stored = await files.find(customId);
          const target = await loadTarget();
          if (stored) {
            return {
              ...stored,
              title: target.fetchedTitle ?? target.documentTitle,
              words: target.wordCount ?? 0,
              reused: true,
            };
          }
          if (!jina) throw new JobFailure("provider_unavailable");
          // Checked first, so a missing setting doesn't spend a Reader call.
          const browserless = deps.browserless;
          if (!browserless) throw new JobFailure("render_failed");

          await setImportStatus(db, importId, "fetching");
          const started = performance.now();
          let article;
          try {
            article = await jina.readUrl(sourceUrl, { timeoutSeconds: 30 });
          } catch (error) {
            // Reader's own 4xx means the page itself could not be read.
            if (error instanceof ProviderError && !error.retryable)
              throw new JobFailure("import_failed");
            throw error;
          }
          await recordAiRun(db, {
            userId: ownerId,
            jobId,
            purpose: "web-import",
            provider: "jina",
            model: "reader",
            inputTokens: article.usage.tokens ?? 0,
            latencyMs: performance.now() - started,
            status: "succeeded",
            metadata: { importId },
          });

          const markdown = article.content;
          const words = countWords(markdown);
          if (
            Buffer.byteLength(markdown, "utf8") > MAX_IMPORT_MARKDOWN_BYTES ||
            words > MAX_IMPORT_WORDS
          ) {
            throw new JobFailure("page_too_long");
          }
          if (words < MIN_IMPORT_WORDS) throw new JobFailure("unsupported_page");

          const title = cleanTitle(article.title, target.documentTitle);
          await setImportStatus(db, importId, "rendering", {
            fetchedTitle: title,
            wordCount: words,
          });
          await markJobPhase(db, jobId, "rendering");
          const html = webSnapshotHtml({
            title,
            sourceUrl,
            retrievedAt: new Date(),
            bodyHtml: markdownToSafeHtml(markdown),
          });
          if (Buffer.byteLength(html, "utf8") > MAX_SNAPSHOT_HTML_BYTES) {
            throw new JobFailure("page_too_long");
          }
          let pdf: Uint8Array;
          try {
            pdf = await renderHtmlToPdf(browserless, html, {
              displayHeaderFooter: true,
              ...webSnapshotHeaderFooter(title),
            });
          } catch (error) {
            if (error instanceof ProviderError) throw error;
            throw new JobFailure("render_failed");
          }
          if (pdf.byteLength > MAX_SOURCE_PDF_BYTES) throw new JobFailure("page_too_long");

          await guard();
          await markJobPhase(db, jobId, "saving");
          const uploaded = await files.upload({ name: "web-snapshot.pdf", data: pdf, customId });
          return { ...uploaded, title, words, reused: false };
        }),
      );

      // 6–7. The snapshot becomes a queued version; ingestion takes it from here.
      const created = await step.run("create-version", () =>
        guarded(async () => {
          await guard();
          const result = await createSnapshotVersion(db, {
            importId,
            jobId,
            userId: ownerId,
            documentId,
            title: snapshot.title,
            wordCount: snapshot.words,
            file: { key: snapshot.key, size: snapshot.size },
            acl: deps.fileAcl,
            embedding: deps.embedding,
          });
          if ("refused" in result) {
            await files.delete([snapshot.key]);
            throw new JobFailure("storage_limit");
          }
          await commitImportUsage(db, importId);
          return result;
        }),
      );

      await step.run("start-ingestion", () =>
        deliverPending(db, (events) => inngest.send(events), { keys: [created.eventKey] }),
      );
      return { versionId: created.versionId };
    },
  );
}
