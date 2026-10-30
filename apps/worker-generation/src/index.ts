import { EnvValidationError } from "@foliomind/contracts";
import { connect, createInngest, createSystemPingFunction } from "@foliomind/workflows";
import { pino } from "pino";
import { loadEnv, type WorkerEnv } from "./env";

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

logger.info("worker booted");

// Phase 8 registers the Section 9 Worker B functions here.
const connection = await connect({
  apps: [{ client: inngest, functions: [createSystemPingFunction(inngest)] }],
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
