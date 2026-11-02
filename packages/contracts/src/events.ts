import { z } from "zod";

/*
 * Inngest event names and payload schemas (blueprint Section 9). Payloads carry
 * IDs and operation keys only, never document text. `@foliomind/workflows`
 * wraps these schemas as typed Inngest event types.
 */

export const EVENT_NAMES = {
  systemPingRequested: "system/ping.requested",
  documentVersionUploaded: "document/version.uploaded",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** Connectivity check: every connected worker app answers with a run. */
export const systemPingRequestedData = z.object({
  requestedAt: z.iso.datetime(),
  source: z.string().min(1).max(64),
});
export type SystemPingRequestedData = z.infer<typeof systemPingRequestedData>;

/** A verified upload created a queued version; Worker A's ingest-document consumes it (Phase 6). */
export const documentVersionUploadedData = z.object({
  documentId: z.uuid(),
  versionId: z.uuid(),
  ownerId: z.uuid(),
  jobId: z.uuid(),
  operationKey: z.string().min(1).max(200),
});
export type DocumentVersionUploadedData = z.infer<typeof documentVersionUploadedData>;

/**
 * Payload schema per event name. The outbox validates against it before a row
 * is written, so only well-formed events are ever queued for delivery.
 */
export const EVENT_SCHEMAS = {
  [EVENT_NAMES.systemPingRequested]: systemPingRequestedData,
  [EVENT_NAMES.documentVersionUploaded]: documentVersionUploadedData,
} as const satisfies Record<EventName, z.ZodType>;

export type EventData<TName extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[TName]>;

export function isEventName(value: string): value is EventName {
  return Object.hasOwn(EVENT_SCHEMAS, value);
}
