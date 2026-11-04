import {
  baseShape,
  browserlessShape,
  directDatabaseShape,
  inngestWorkerShape,
  jinaShape,
  parseEnv,
  PRODUCTION_REQUIRED,
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
  // Section 9 starting limits; load-test before raising them.
  INGESTION_CONCURRENCY: concurrency(1),
  IMPORT_CONCURRENCY: concurrency(2),
  CONTROL_CONCURRENCY: concurrency(2),
  /**
   * `dispatch-outbox` schedule. The web app delivers events right after
   * commit, so this sweep only recovers failed sends. Every 10 minutes keeps
   * Inngest's free plan (50k executions a month) and Neon's scale-to-zero
   * within budget; Section 9's every-minute sweep suits paid plans.
   */
  OUTBOX_DISPATCH_CRON: z
    .string()
    .regex(/^(TZ=\S+ )?(\S+ ){4}\S+$/, "a five-field cron expression")
    .default("*/10 * * * *"),
  /**
   * "1" lets cleanup delete stored files no asset row knows about. Only safe
   * when this environment has its own UploadThing app (Section 25).
   */
  ORPHAN_FILE_SWEEP: z.enum(["0", "1"]).default("0"),
  /** The web app's address, so imports of FolioMind's own pages are refused. */
  APP_BASE_URL: z.url().optional(),
  /** Hard limit and memory cap for the PDF parsing child process. */
  EXTRACTION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),
  EXTRACTION_MEMORY_MB: z.coerce.number().int().min(128).max(4096).default(512),
  /** Render sets this per deploy; Inngest uses it for rolling deploys. */
  RENDER_GIT_COMMIT: z.string().optional(),
});

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv("worker-ingestion", schema, source, PRODUCTION_REQUIRED.workerIngestion);
}

export type WorkerEnv = ReturnType<typeof loadEnv>;
