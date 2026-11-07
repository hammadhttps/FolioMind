import { createHash } from "node:crypto";
import { ProviderError } from "@foliomind/contracts";
import {
  assertProjectJobCanContinue,
  commitProjectUsage,
  completeExport,
  exportCustomId,
  failExport,
  jobAlreadySucceeded,
  jobErrorCodeFrom,
  JobFailure,
  JobStopped,
  loadExportContext,
  markExportRendering,
  markJobPhase,
  type ExportContext,
} from "@foliomind/domain";
import { renderHtmlToPdf } from "@foliomind/pdf";
import {
  MAX_EXPORT_HTML_BYTES,
  MAX_EXPORT_PAGES,
  projectDocumentHtml,
  projectHeaderFooter,
} from "@foliomind/pdf/project";
import type { Inngest } from "inngest";
import { notificationCreated, projectExportRequested } from "../../events";
import { guarded, isStopped } from "../ingestion/shared";
import { countExportPages, heavyConcurrency, MAX_EXPORT_BYTES, type WorkerBDeps } from "./shared";

/*
 * `render-export` (blueprint Sections 9 and 26): load the exact revision → build
 * sanitized HTML → Browserless PDF → checksum and page count → upload → mark
 * ready → notify. A retry looks for a file an earlier attempt already uploaded
 * under the operation's `customId`, so it can never store two.
 */

const safeFileName = (title: string) =>
  `${
    title
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "foliomind-export"
  }.pdf`;

function buildHtml(context: ExportContext): string {
  return projectDocumentHtml({
    title: context.title,
    mode: context.mode,
    template: context.template,
    pageSize: context.settings.pageSize,
    cover: context.settings.cover,
    contents: context.settings.contents,
    audience: context.settings.audience,
    date: new Date(),
    doc: context.content,
    sources: context.sources,
  });
}

export function createRenderExportFunction(inngest: Inngest, deps: WorkerBDeps) {
  const { db, files } = deps;
  return inngest.createFunction(
    {
      id: "render-export",
      name: "Render project export",
      triggers: [projectExportRequested],
      retries: 3,
      idempotency: "event.data.operationKey",
      concurrency: [heavyConcurrency(deps.heavyConcurrency)],
      onFailure: async ({ event, error, step }) => {
        const { jobId, projectId, ownerId, exportId, usageKey } = event.data.event.data;
        const failed = await step.run("record-failure", async () => {
          const code = isStopped(error) ? "cancelled" : jobErrorCodeFrom(error);
          deps.logger.warn({ jobId, projectId, code }, "export failed");
          return failExport(db, { exportId, jobId, projectId, usageKey, code });
        });
        if (!failed || isStopped(error)) return;
        await step.sendEvent("notify-failure", {
          id: `notify:export_failed:${jobId}`,
          name: notificationCreated.name,
          data: {
            userId: ownerId,
            type: "export_failed",
            subjectId: projectId,
            operationKey: `export_failed:${jobId}`,
          },
        });
      },
    },
    async ({ event, step, runId, attempt }) => {
      const { projectId, ownerId, jobId, exportId, revisionId, operationKey, usageKey } =
        event.data;

      const result = await step.run("render", () =>
        guarded(async () => {
          if (await jobAlreadySucceeded(db, jobId)) return { pages: 0 };
          await assertProjectJobCanContinue(db, jobId, projectId);
          await markJobPhase(db, jobId, "composing", {
            run: { runId, eventId: event.id, attempt },
          });
          await markExportRendering(db, exportId);

          const context = await loadExportContext(db, { exportId, ownerId, revisionId });
          if (!context) throw new JobStopped("missing");

          const customId = exportCustomId(operationKey);
          let file = await files.find(customId);
          let pdf: Uint8Array;
          let renderMs = 0;
          let htmlBytes = 0;
          if (file) {
            // An earlier attempt stored it: read it back for the checksum and page count.
            const stored = await fetch(files.url(file.key), {
              signal: AbortSignal.timeout(30_000),
            });
            if (!stored.ok) throw new JobFailure("export_failed");
            pdf = new Uint8Array(await stored.arrayBuffer());
          } else {
            if (!deps.browserless) throw new JobFailure("export_failed");
            const html = buildHtml(context);
            htmlBytes = Buffer.byteLength(html, "utf8");
            if (htmlBytes > MAX_EXPORT_HTML_BYTES) throw new JobFailure("export_too_large");
            await markJobPhase(db, jobId, "exporting");
            const started = performance.now();
            try {
              pdf = await renderHtmlToPdf(deps.browserless, html, {
                format: context.settings.pageSize,
                displayHeaderFooter: true,
                accessible: true,
                ...projectHeaderFooter(context),
              });
            } catch (error) {
              if (error instanceof ProviderError) throw error;
              throw new JobFailure("export_failed");
            }
            renderMs = Math.round(performance.now() - started);
            if (pdf.byteLength > MAX_EXPORT_BYTES) throw new JobFailure("export_too_large");
          }

          const pageCount = await countExportPages(deps, pdf, MAX_EXPORT_PAGES);
          const checksum = createHash("sha256").update(pdf).digest("hex");

          if (!file) {
            await assertProjectJobCanContinue(db, jobId, projectId);
            await markJobPhase(db, jobId, "uploading");
            file = await files.upload({ name: safeFileName(context.title), data: pdf, customId });
          }
          const saved = await completeExport(db, {
            exportId,
            jobId,
            projectId,
            ownerId,
            operationKey,
            file,
            checksum,
            pageCount,
            acl: deps.fileAcl,
            metrics: { renderMs, htmlBytes, pageCount, bytes: file.size },
          });
          if (!saved) {
            await files.delete([file.key]);
            throw new JobFailure("storage_limit");
          }
          return { pages: pageCount };
        }),
      );

      await step.run("commit-usage", () => commitProjectUsage(db, usageKey));
      await step.sendEvent("notify-ready", {
        id: `notify:export_ready:${jobId}`,
        name: notificationCreated.name,
        data: {
          userId: ownerId,
          type: "export_ready",
          subjectId: projectId,
          operationKey: `export_ready:${jobId}`,
        },
      });
      return result;
    },
  );
}
