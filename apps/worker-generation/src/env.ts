import {
  baseShape,
  browserlessShape,
  directDatabaseShape,
  geminiShape,
  inngestWorkerShape,
  jinaShape,
  parseEnv,
  PRODUCTION_REQUIRED,
  upstashShape,
  uploadthingShape,
} from "@foliomind/contracts";
import { z } from "zod";

/** Worker B variables (blueprint Section 13), least privilege: no Auth0 or Stripe. */
const schema = z.object({
  ...baseShape,
  ...directDatabaseShape,
  ...upstashShape,
  ...inngestWorkerShape,
  ...uploadthingShape,
  ...browserlessShape,
  ...jinaShape,
  ...geminiShape,
  // One heavy run at a time across generation and export (Section 9).
  GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
});

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv("worker-generation", schema, source, PRODUCTION_REQUIRED.workerGeneration);
}

export type WorkerEnv = ReturnType<typeof loadEnv>;
