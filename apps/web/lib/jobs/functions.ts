import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { createGemini } from "@foliomind/ai";
import { createJina } from "@foliomind/ai/jina";
import { cacheKeys, createRedis } from "@foliomind/domain";
import { createInngest } from "@foliomind/workflows";
import {
  createExtractor,
  createFileStore,
  createWorkerAFunctions,
} from "@foliomind/workflows/worker-a";
import { createWorkerBFunctions } from "@foliomind/workflows/worker-b";
import { appEnv, env } from "@/env";
import { getDb } from "@/lib/clients";

/*
 * Background functions on Vercel (user decision, 2026-11-04: Vercel is the only
 * host). Inngest calls /api/inngest for each step; nothing runs between calls.
 * Worker A's and Worker B's functions are the same ones the Docker workers run,
 * wired to this deployment's settings.
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
  const db = getDb();
  const jina = env.JINA_API_KEY
    ? createJina({
        apiKey: env.JINA_API_KEY,
        embeddingModel: env.JINA_EMBEDDING_MODEL,
        embeddingDimension: env.JINA_EMBEDDING_DIMENSION,
        rerankerModel: env.JINA_RERANKER_MODEL,
        timeoutMs: 60_000,
      })
    : null;
  const extract = createExtractor({
    childPath: path.resolve(appDir, "../../packages/workflows/src/ingestion/extract-child.mjs"),
    pdfjsRoot: path.join(appDir, "node_modules/pdfjs-dist"),
    timeoutMs: env.EXTRACTION_TIMEOUT_MS,
    memoryMb: env.EXTRACTION_MEMORY_MB,
  });
  const files = createFileStore(env.UPLOADTHING_TOKEN ?? "");
  const browserless =
    env.BROWSERLESS_WS_ENDPOINT && env.BROWSERLESS_TOKEN
      ? { wsEndpoint: env.BROWSERLESS_WS_ENDPOINT, token: env.BROWSERLESS_TOKEN }
      : null;
  const embedding = { model: env.JINA_EMBEDDING_MODEL, dimension: env.JINA_EMBEDDING_DIMENSION };
  const logger = { info: logLine("info"), warn: logLine("warn"), error: logLine("error") };
  // The free UploadThing plan has public files only (user decision, Phase 5).
  const fileAcl = "public" as const;

  const workerA = createWorkerAFunctions(client, {
    db,
    jina,
    extract,
    files,
    browserless,
    embedding,
    fileAcl,
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
    logger,
  });
  const workerB = createWorkerBFunctions(client, {
    db,
    gemini: env.GEMINI_API_KEY
      ? createGemini({ apiKey: env.GEMINI_API_KEY, timeoutMs: 120_000 })
      : null,
    jina,
    redis: createRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    cacheKeys: cacheKeys(appEnv),
    models: { generation: env.GEMINI_GENERATION_MODEL, fast: env.GEMINI_FAST_MODEL },
    embedding,
    browserless,
    files,
    fileAcl,
    extract,
    heavyConcurrency: env.GENERATION_CONCURRENCY,
    logger,
  });
  return { client, functions: [...workerA, ...workerB] };
}
