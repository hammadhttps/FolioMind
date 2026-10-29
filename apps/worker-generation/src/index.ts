import { pino } from "pino";

const logger = pino({ base: { service: "foliomind-generation" } });

logger.info("worker booted");

// Phase 2 replaces this keep-alive with the Inngest Connect connection.
const keepAlive = setInterval(() => {}, 60_000);

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "shutting down");
  clearInterval(keepAlive);
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
