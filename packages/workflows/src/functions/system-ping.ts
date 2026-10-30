import type { Inngest } from "inngest";
import { systemPingRequested } from "../events";

/**
 * Connectivity check registered by every worker app: one run per connected
 * app proves the worker is reachable through Inngest Connect.
 */
export function createSystemPingFunction(inngest: Inngest) {
  return inngest.createFunction(
    { id: "system-ping", name: "System ping", triggers: [systemPingRequested], retries: 0 },
    async ({ event, step }) =>
      step.run("respond", () => ({
        app: inngest.id,
        source: event.data.source,
        requestedAt: event.data.requestedAt,
        respondedAt: new Date().toISOString(),
      })),
  );
}
