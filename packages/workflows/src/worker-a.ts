import type { Inngest } from "inngest";
import {
  createCleanupMaintenanceFunction,
  createDispatchOutboxFunction,
  createSendNotificationFunction,
} from "./functions/ingestion/control";
import { createImportUrlFunction } from "./functions/ingestion/import-url";
import { createIngestDocumentFunction } from "./functions/ingestion/ingest-document";
import type { WorkerADeps } from "./functions/ingestion/shared";
import { createSystemPingFunction } from "./functions/system-ping";

/*
 * Worker A (`foliomind-ingestion`) functions, blueprint Section 9. Production
 * serves them from the web app's /api/inngest route on Vercel; the Docker worker
 * runs the same functions through Connect for local development or a later move.
 * Only those two entry points import this file, so ordinary web pages never
 * bundle parsing, rendering or provider code.
 */

export function createWorkerAFunctions(inngest: Inngest, deps: WorkerADeps) {
  return [
    createSystemPingFunction(inngest),
    createIngestDocumentFunction(inngest, deps),
    createImportUrlFunction(inngest, deps),
    createSendNotificationFunction(inngest, deps),
    createDispatchOutboxFunction(inngest, deps),
    createCleanupMaintenanceFunction(inngest, deps),
  ];
}

export { EMBED_BATCH_SIZE } from "./functions/ingestion/ingest-document";
export type {
  FileStore,
  StoredFile,
  WorkerADeps,
  WorkerLogger,
} from "./functions/ingestion/shared";
export * from "./ingestion/chunking";
export * from "./ingestion/extraction";
export * from "./ingestion/extractor";
export * from "./ingestion/file-store";
export * from "./ingestion/pages";
