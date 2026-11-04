import { z } from "zod";
import { notificationTypeSchema } from "./notifications";

/*
 * Inngest event names and payload schemas (blueprint Section 9). Payloads carry
 * IDs and operation keys only, never document text. `@foliomind/workflows`
 * wraps these schemas as typed Inngest event types.
 */

export const EVENT_NAMES = {
  systemPingRequested: "system/ping.requested",
  documentVersionUploaded: "document/version.uploaded",
  documentVersionCancelled: "document/version.cancelled",
  documentUrlImportRequested: "document/url-import.requested",
  notificationCreated: "notification/created",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** Connectivity check: every connected worker app answers with a run. */
export const systemPingRequestedData = z.object({
  requestedAt: z.iso.datetime(),
  source: z.string().min(1).max(64),
});
export type SystemPingRequestedData = z.infer<typeof systemPingRequestedData>;

/** A verified upload or import created a queued version; Worker A's ingest-document consumes it. */
export const documentVersionUploadedData = z.object({
  documentId: z.uuid(),
  versionId: z.uuid(),
  ownerId: z.uuid(),
  jobId: z.uuid(),
  operationKey: z.string().min(1).max(200),
});
export type DocumentVersionUploadedData = z.infer<typeof documentVersionUploadedData>;

/**
 * The owner cancelled a job. Cancels the matching ingest-document or
 * import-url run (`cancelOn` matches `jobId`); the cancel route has already
 * marked the job cancelled.
 */
export const documentVersionCancelledData = z.object({
  jobId: z.uuid(),
  ownerId: z.uuid(),
  operationKey: z.string().min(1).max(200),
});
export type DocumentVersionCancelledData = z.infer<typeof documentVersionCancelledData>;

/** A web article import was accepted (Section 27 step 2); Worker A's import-url consumes it. */
export const documentUrlImportRequestedData = z.object({
  importId: z.uuid(),
  documentId: z.uuid(),
  ownerId: z.uuid(),
  jobId: z.uuid(),
  operationKey: z.string().min(1).max(200),
});
export type DocumentUrlImportRequestedData = z.infer<typeof documentUrlImportRequestedData>;

/**
 * Something the user should hear about. IDs only: send-notification writes the
 * in-app row from the type, so no document text travels in the event.
 */
export const notificationCreatedData = z.object({
  userId: z.uuid(),
  type: notificationTypeSchema,
  /** The document the notice is about. */
  subjectId: z.uuid(),
  /** Unique per user; a repeat delivery writes nothing new. */
  operationKey: z.string().min(1).max(200),
});
export type NotificationCreatedData = z.infer<typeof notificationCreatedData>;

/**
 * Payload schema per event name. The outbox validates against it before a row
 * is written, so only well-formed events are ever queued for delivery.
 */
export const EVENT_SCHEMAS = {
  [EVENT_NAMES.systemPingRequested]: systemPingRequestedData,
  [EVENT_NAMES.documentVersionUploaded]: documentVersionUploadedData,
  [EVENT_NAMES.documentVersionCancelled]: documentVersionCancelledData,
  [EVENT_NAMES.documentUrlImportRequested]: documentUrlImportRequestedData,
  [EVENT_NAMES.notificationCreated]: notificationCreatedData,
} as const satisfies Record<EventName, z.ZodType>;

export type EventData<TName extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[TName]>;

export function isEventName(value: string): value is EventName {
  return Object.hasOwn(EVENT_SCHEMAS, value);
}
