import {
  baseShape,
  browserlessShape,
  directDatabaseShape,
  inngestWorkerShape,
  jinaShape,
  parseEnv,
  PRODUCTION_REQUIRED,
  pushengageShape,
  stripeSecretShape,
  upstashShape,
  uploadthingShape,
} from "@foliomind/contracts";
import { z } from "zod";

const concurrency = (fallback: number) => z.coerce.number().int().min(1).max(16).default(fallback);

/** Worker A variables (blueprint Section 13), least privilege: no Auth0 or Gemini. */
const schema = z.object({
  ...baseShape,
  ...directDatabaseShape,
  ...upstashShape,
  ...inngestWorkerShape,
  ...uploadthingShape,
  ...browserlessShape,
  ...jinaShape,
  ...stripeSecretShape,
  ...pushengageShape,
  // Section 9 starting limits; load-test before raising them.
  INGESTION_CONCURRENCY: concurrency(1),
  IMPORT_CONCURRENCY: concurrency(2),
  CONTROL_CONCURRENCY: concurrency(2),
});

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv("worker-ingestion", schema, source, PRODUCTION_REQUIRED.workerIngestion);
}

export type WorkerEnv = ReturnType<typeof loadEnv>;
