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
  projectOutlineRequested: "project/outline.requested",
  projectDraftRequested: "project/draft.requested",
  projectSectionRequested: "project/section.requested",
  projectExportRequested: "project/export.requested",
  projectGenerationCancelled: "project/generation.cancelled",
  catalogBookPublished: "catalog/book.published",
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
  /** The document, project, publisher profile or book revision the notice is about. */
  subjectId: z.uuid(),
  /** Unique per user; a repeat delivery writes nothing new. */
  operationKey: z.string().min(1).max(200),
});
export type NotificationCreatedData = z.infer<typeof notificationCreatedData>;

/** What every Worker B request carries; the usage key is what `onFailure` releases. */
const projectJobData = z.object({
  projectId: z.uuid(),
  ownerId: z.uuid(),
  jobId: z.uuid(),
  operationKey: z.string().min(1).max(200),
  /** The reservation this job holds; null when an earlier charge already covers it. */
  usageKey: z.string().min(1).max(200).nullable(),
});

export const projectOutlineRequestedData = projectJobData;
export type ProjectOutlineRequestedData = z.infer<typeof projectOutlineRequestedData>;

export const projectDraftRequestedData = projectJobData.extend({
  /** Redraft every section, instead of filling in the ones not written yet. */
  replace: z.boolean(),
});
export type ProjectDraftRequestedData = z.infer<typeof projectDraftRequestedData>;

export const projectSectionRequestedData = projectJobData.extend({ sectionId: z.uuid() });
export type ProjectSectionRequestedData = z.infer<typeof projectSectionRequestedData>;

export const projectExportRequestedData = projectJobData.extend({
  exportId: z.uuid(),
  revisionId: z.uuid(),
});
export type ProjectExportRequestedData = z.infer<typeof projectExportRequestedData>;

/** Stops a running generation between steps; the cancel route has marked the job already. */
export const projectGenerationCancelledData = z.object({
  jobId: z.uuid(),
  ownerId: z.uuid(),
  operationKey: z.string().min(1).max(200),
});
export type ProjectGenerationCancelledData = z.infer<typeof projectGenerationCancelledData>;

/**
 * A moderator approved a book revision (Section 6 "Publishing"). Worker A's
 * notify-followers tells the publisher's followers in bounded batches, each
 * notice going through send-notification.
 */
export const catalogBookPublishedData = z.object({
  bookId: z.uuid(),
  revisionId: z.uuid(),
  publisherId: z.uuid(),
  operationKey: z.string().min(1).max(200),
});
export type CatalogBookPublishedData = z.infer<typeof catalogBookPublishedData>;

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
  [EVENT_NAMES.projectOutlineRequested]: projectOutlineRequestedData,
  [EVENT_NAMES.projectDraftRequested]: projectDraftRequestedData,
  [EVENT_NAMES.projectSectionRequested]: projectSectionRequestedData,
  [EVENT_NAMES.projectExportRequested]: projectExportRequestedData,
  [EVENT_NAMES.projectGenerationCancelled]: projectGenerationCancelledData,
  [EVENT_NAMES.catalogBookPublished]: catalogBookPublishedData,
} as const satisfies Record<EventName, z.ZodType>;

export type EventData<TName extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[TName]>;

export function isEventName(value: string): value is EventName {
  return Object.hasOwn(EVENT_SCHEMAS, value);
}
