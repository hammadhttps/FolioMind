import "server-only";
import { deliverPending } from "@foliomind/domain";
import { getDb, getInngest } from "@/lib/clients";

/**
 * Sends just-committed outbox events now (Section 3). A failure is harmless:
 * Worker A's dispatch-outbox sweep re-sends anything still undelivered.
 */
export async function deliverNow(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await deliverPending(getDb(), (events) => getInngest().send(events), { keys }).catch(
    (error: unknown) => {
      console.error(
        JSON.stringify({ event: "outbox.deliver_failed", name: (error as Error)?.name ?? "Error" }),
      );
    },
  );
}
