import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
// Jina only: the background functions have no use for the Gemini SDK.
import { createJina } from "@foliomind/ai/jina";
import { createInngest } from "@foliomind/workflows";
import {
  createExtractor,
  createFileStore,
  createWorkerAFunctions,
} from "@foliomind/workflows/worker-a";
import { env } from "@/env";
import { getDb } from "@/lib/clients";

/*
 * Background functions on Vercel (user decision, 2026-11-04: Vercel is the only
 * host). Inngest calls /api/inngest for each step; nothing runs between calls.
 * The functions are the same ones the Docker worker runs, wired to this
 * deployment's settings.
 */

/** Longest time one request keeps running steps; the route's limit is 300 s. */
const CHECKPOINT_MAX_RUNTIME = "60s";

/** Production's stable address, so Inngest never calls a protected per-deployment URL. */
export function serveOrigin(): string | undefined {
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return process.env.VERCEL_ENV === "production" && domain ? `https://${domain}` : undefined;
}

/** The app directory: the working directory on Vercel and in the standalone image. */
function appDirectory(): string {
  const cwd = process.cwd();
  return existsSync(path.join(cwd, "node_modules/pdfjs-dist/package.json"))
    ? cwd
    : path.join(cwd, "apps/web");
}

const logLine =
  (level: "info" | "warn" | "error") => (fields: Record<string, unknown>, message?: string) => {
    console[level](JSON.stringify({ source: "background-functions", level, message, ...fields }));
  };

export function createBackgroundFunctions() {
  const client = createInngest({
    appId: "foliomind-ingestion",
    isDev: env.INNGEST_DEV === "1",
    eventKey: env.INNGEST_EVENT_KEY,
    signingKey: env.INNGEST_SIGNING_KEY,
    baseUrl: env.INNGEST_BASE_URL,
    checkpointing: { maxRuntime: CHECKPOINT_MAX_RUNTIME },
  });
  const appDir = appDirectory();
  const functions = createWorkerAFunctions(client, {
    db: getDb(),
    jina: env.JINA_API_KEY
      ? createJina({
          apiKey: env.JINA_API_KEY,
          embeddingModel: env.JINA_EMBEDDING_MODEL,
          embeddingDimension: env.JINA_EMBEDDING_DIMENSION,
          rerankerModel: env.JINA_RERANKER_MODEL,
          timeoutMs: 60_000,
        })
      : null,
    extract: createExtractor({
      childPath: path.resolve(appDir, "../../packages/workflows/src/ingestion/extract-child.mjs"),
      pdfjsRoot: path.join(appDir, "node_modules/pdfjs-dist"),
      timeoutMs: env.EXTRACTION_TIMEOUT_MS,
      memoryMb: env.EXTRACTION_MEMORY_MB,
    }),
    files: createFileStore(env.UPLOADTHING_TOKEN ?? ""),
    browserless:
      env.BROWSERLESS_WS_ENDPOINT && env.BROWSERLESS_TOKEN
        ? { wsEndpoint: env.BROWSERLESS_WS_ENDPOINT, token: env.BROWSERLESS_TOKEN }
        : null,
    embedding: { model: env.JINA_EMBEDDING_MODEL, dimension: env.JINA_EMBEDDING_DIMENSION },
    // The free UploadThing plan has public files only (user decision, Phase 5).
    fileAcl: "public",
    concurrency: {
      ingestion: env.INGESTION_CONCURRENCY,
      imports: env.IMPORT_CONCURRENCY,
      control: env.CONTROL_CONCURRENCY,
    },
    outboxCron: env.OUTBOX_DISPATCH_CRON,
    orphanFileSweep: env.ORPHAN_FILE_SWEEP === "1",
    ownHosts: [
      "folio-mind-two.vercel.app",
      ...(env.APP_BASE_URL ? [new URL(env.APP_BASE_URL).hostname] : []),
    ],
    logger: { info: logLine("info"), warn: logLine("warn"), error: logLine("error") },
  });
  return { client, functions };
}
