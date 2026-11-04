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
 * Worker A (`foliomind-ingestion`) functions, blueprint Section 9. Billing sync
 * and reconciliation join in Phase 10. Imported only by the worker, so the web
 * app never bundles parsing, rendering or provider code.
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
export * from "./ingestion/pages";
