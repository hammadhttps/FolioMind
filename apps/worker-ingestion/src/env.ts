import {
  backgroundJobsShape,
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
  ...backgroundJobsShape,
  /** The web app's address, so imports of FolioMind's own pages are refused. */
  APP_BASE_URL: z.url().optional(),
  /** Render sets this per deploy; Inngest uses it for rolling deploys. */
  RENDER_GIT_COMMIT: z.string().optional(),
});

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv("worker-ingestion", schema, source, PRODUCTION_REQUIRED.workerIngestion);
}

export type WorkerEnv = ReturnType<typeof loadEnv>;
