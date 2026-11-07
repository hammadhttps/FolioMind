import { createGemini } from "@foliomind/ai";
import { createJina } from "@foliomind/ai/jina";
import { EnvValidationError } from "@foliomind/contracts";
import { createDb } from "@foliomind/db";
import { cacheKeys, createRedis } from "@foliomind/domain";
import { connect, createInngest, createSystemPingFunction } from "@foliomind/workflows";
import { createFileStore } from "@foliomind/workflows/worker-a";
import { createWorkerBFunctions } from "@foliomind/workflows/worker-b";
import { pino } from "pino";
import { loadEnv, type WorkerEnv } from "./env";
import { createWorkerExtractor } from "./extract";

const SERVICE = "foliomind-generation";

let env: WorkerEnv;
try {
  env = loadEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    // Variable names only; values never reach the logs.
    console.error(
      JSON.stringify({ service: SERVICE, msg: error.message, variables: error.variables }),
    );
    process.exit(1);
  }
  throw error;
}

const logger = pino({ base: { service: SERVICE, appEnv: env.appEnv }, level: env.LOG_LEVEL });

const inngest = createInngest({
  appId: "foliomind-generation",
  isDev: env.INNGEST_DEV === "1",
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
  baseUrl: env.INNGEST_BASE_URL,
  logger,
});

// Bounded direct connections (Section 3); workers touch Neon only while executing.
const database = createDb({ url: env.DIRECT_DATABASE_URL, role: "worker", max: 4 });

if (!env.GEMINI_API_KEY) logger.warn("GEMINI_API_KEY is not set: generation will fail");
if (!env.JINA_API_KEY) logger.warn("JINA_API_KEY is not set: research drafts will fail");
if (!env.UPLOADTHING_TOKEN) logger.warn("UPLOADTHING_TOKEN is not set: exports will fail");

const functions = [
  createSystemPingFunction(inngest),
  ...createWorkerBFunctions(inngest, {
    db: database.db,
    gemini: env.GEMINI_API_KEY
      ? createGemini({ apiKey: env.GEMINI_API_KEY, timeoutMs: 120_000 })
      : null,
    jina: env.JINA_API_KEY
      ? createJina({
          apiKey: env.JINA_API_KEY,
          embeddingModel: env.JINA_EMBEDDING_MODEL,
          embeddingDimension: env.JINA_EMBEDDING_DIMENSION,
          rerankerModel: env.JINA_RERANKER_MODEL,
          timeoutMs: 60_000,
        })
      : null,
    redis: createRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    cacheKeys: cacheKeys(env.appEnv),
    models: { generation: env.GEMINI_GENERATION_MODEL, fast: env.GEMINI_FAST_MODEL },
    embedding: { model: env.JINA_EMBEDDING_MODEL, dimension: env.JINA_EMBEDDING_DIMENSION },
    browserless: { wsEndpoint: env.BROWSERLESS_WS_ENDPOINT, token: env.BROWSERLESS_TOKEN },
    files: createFileStore(env.UPLOADTHING_TOKEN ?? ""),
    // The free UploadThing plan has public files only (user decision, Phase 5).
    fileAcl: "public",
    extract: createWorkerExtractor({
      timeoutMs: env.EXTRACTION_TIMEOUT_MS,
      memoryMb: env.EXTRACTION_MEMORY_MB,
    }),
    heavyConcurrency: env.GENERATION_CONCURRENCY,
    logger,
  }),
];

logger.info({ functions: functions.length }, "worker booted");

const connection = await connect({
  apps: [{ client: inngest, functions }],
  ...(env.WORKER_INSTANCE_ID ? { instanceId: env.WORKER_INSTANCE_ID } : {}),
  // Shutdown is handled below so it is logged and exits with a clear status.
  handleShutdownSignals: [],
});
logger.info({ connectionId: connection.connectionId }, "connected to Inngest");

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    // Stops claiming new work and lets in-flight steps finish (Section 9).
    await connection.close();
    logger.info("Inngest connection closed");
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", (signal) => void shutdown(signal));
process.once("SIGINT", (signal) => void shutdown(signal));
