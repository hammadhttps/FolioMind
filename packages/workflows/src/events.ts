import {
  documentUrlImportRequestedData,
  documentVersionCancelledData,
  documentVersionUploadedData,
  EVENT_NAMES,
  notificationCreatedData,
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
