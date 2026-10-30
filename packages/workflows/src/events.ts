import { EVENT_NAMES, systemPingRequestedData } from "@foliomind/contracts";
import { eventType } from "inngest";

/** Typed Inngest event definitions built from the Zod schemas in @foliomind/contracts. */
export const systemPingRequested = eventType(EVENT_NAMES.systemPingRequested, {
  schema: systemPingRequestedData,
});
