import { z } from "zod";

/*
 * Inngest event names and payload schemas (blueprint Section 9). Payloads carry
 * IDs and operation keys only, never document text. `@foliomind/workflows`
 * wraps these schemas as typed Inngest event types.
 */

export const EVENT_NAMES = {
  systemPingRequested: "system/ping.requested",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** Connectivity check: every connected worker app answers with a run. */
export const systemPingRequestedData = z.object({
  requestedAt: z.iso.datetime(),
  source: z.string().min(1).max(64),
});
export type SystemPingRequestedData = z.infer<typeof systemPingRequestedData>;
