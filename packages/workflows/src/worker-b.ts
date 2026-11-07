import type { Inngest } from "inngest";
import { createGenerateDraftFunction } from "./functions/generation/generate-draft";
import { createGenerateOutlineFunction } from "./functions/generation/generate-outline";
import { createRegenerateSectionFunction } from "./functions/generation/regenerate-section";
import { createRenderExportFunction } from "./functions/generation/render-export";
import type { WorkerBDeps } from "./functions/generation/shared";

/*
 * Worker B (`foliomind-generation`) functions, blueprint Section 9. Production
 * serves them from the web app's /api/inngest route on Vercel; the Docker worker
 * runs the same functions through Connect for local development.
 */

export function createWorkerBFunctions(inngest: Inngest, deps: WorkerBDeps) {
  return [
    createGenerateOutlineFunction(inngest, deps),
    createGenerateDraftFunction(inngest, deps),
    createRegenerateSectionFunction(inngest, deps),
    createRenderExportFunction(inngest, deps),
  ];
}

export type { WorkerBDeps } from "./functions/generation/shared";
