// Jina only: Worker A has no Gemini access (least privilege), and the Gemini SDK
// is not part of its bundle.
import { createJina } from "@foliomind/ai/jina";
import { EnvValidationError } from "@foliomind/contracts";
import { createDb } from "@foliomind/db";
import { connect, createInngest } from "@foliomind/workflows";
import { createWorkerAFunctions } from "@foliomind/workflows/worker-a";
import { pino } from "pino";
import { loadEnv, type WorkerEnv } from "./env";
import { createExtractor } from "./extract";
import { createFileStore } from "./files";

const SERVICE = "foliomind-ingestion";

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
  appId: "foliomind-ingestion",
  isDev: env.INNGEST_DEV === "1",
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
  baseUrl: env.INNGEST_BASE_URL,
  appVersion: env.RENDER_GIT_COMMIT,
  logger,
});

// Bounded direct connections (Section 3); workers touch Neon only while executing.
const database = createDb({ url: env.DIRECT_DATABASE_URL, role: "worker", max: 4 });

if (!env.UPLOADTHING_TOKEN)
  logger.warn("UPLOADTHING_TOKEN is not set: ingestion cannot read files");
if (!env.JINA_API_KEY) logger.warn("JINA_API_KEY is not set: embeddings and imports will fail");

const ownHosts = [
  ...(env.APP_BASE_URL ? [new URL(env.APP_BASE_URL).hostname] : []),
  "folio-mind-two.vercel.app",
];

const functions = createWorkerAFunctions(inngest, {
  db: database.db,
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
    timeoutMs: env.EXTRACTION_TIMEOUT_MS,
    memoryMb: env.EXTRACTION_MEMORY_MB,
  }),
  files: createFileStore(env.UPLOADTHING_TOKEN ?? ""),
  browserless: { wsEndpoint: env.BROWSERLESS_WS_ENDPOINT, token: env.BROWSERLESS_TOKEN },
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
  ownHosts,
  logger,
});

logger.info({ functions: functions.length }, "worker booted");

const connection = await connect({
  apps: [{ client: inngest, functions }],
  ...(env.WORKER_INSTANCE_ID ? { instanceId: env.WORKER_INSTANCE_ID } : {}),
  // Section 9 starting limit: ingestion 1 + imports 2 + control 2.
  maxWorkerConcurrency:
    env.INGESTION_CONCURRENCY + env.IMPORT_CONCURRENCY + env.CONTROL_CONCURRENCY,
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
    await database.close();
    logger.info("Inngest connection closed");
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", (signal) => void shutdown(signal));
process.once("SIGINT", (signal) => void shutdown(signal));
