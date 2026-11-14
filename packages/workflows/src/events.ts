import {
  catalogBookPublishedData,
  documentUrlImportRequestedData,
  documentVersionCancelledData,
  documentVersionUploadedData,
  EVENT_NAMES,
  notificationCreatedData,
  projectDraftRequestedData,
  projectExportRequestedData,
  projectGenerationCancelledData,
  projectOutlineRequestedData,
  projectSectionRequestedData,
  systemPingRequestedData,
} from "@foliomind/contracts";
import { eventType } from "inngest";

/** Typed Inngest event definitions built from the Zod schemas in @foliomind/contracts. */
export const systemPingRequested = eventType(EVENT_NAMES.systemPingRequested, {
  schema: systemPingRequestedData,
});

export const documentVersionUploaded = eventType(EVENT_NAMES.documentVersionUploaded, {
  schema: documentVersionUploadedData,
});

export const documentVersionCancelled = eventType(EVENT_NAMES.documentVersionCancelled, {
  schema: documentVersionCancelledData,
});

export const documentUrlImportRequested = eventType(EVENT_NAMES.documentUrlImportRequested, {
  schema: documentUrlImportRequestedData,
});

export const notificationCreated = eventType(EVENT_NAMES.notificationCreated, {
  schema: notificationCreatedData,
});

export const projectOutlineRequested = eventType(EVENT_NAMES.projectOutlineRequested, {
  schema: projectOutlineRequestedData,
});

export const projectDraftRequested = eventType(EVENT_NAMES.projectDraftRequested, {
  schema: projectDraftRequestedData,
});

export const projectSectionRequested = eventType(EVENT_NAMES.projectSectionRequested, {
  schema: projectSectionRequestedData,
});

export const projectExportRequested = eventType(EVENT_NAMES.projectExportRequested, {
  schema: projectExportRequestedData,
});

export const projectGenerationCancelled = eventType(EVENT_NAMES.projectGenerationCancelled, {
  schema: projectGenerationCancelledData,
});

export const catalogBookPublished = eventType(EVENT_NAMES.catalogBookPublished, {
  schema: catalogBookPublishedData,
});
