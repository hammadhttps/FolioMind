/**
 * `pnpm requeue-ingestion` — re-queues uploads whose ingestion never started
 * (blueprint Section 9). Run once after Worker A first connects in an
 * environment: events sent before any worker existed were never consumed.
 * Each stalled job is replaced by a new job and outbox event with a new
 * operation key; Worker A's dispatch-outbox sweep (or `--send`) delivers them.
 *
 * Runs as the migration role over DIRECT_DATABASE_URL (the local Compose
 * database when unset). `--send` also delivers the events now, using
 * INNGEST_EVENT_KEY (or the local Dev Server when INNGEST_DEV=1).
 */
import { resolveAppEnv } from "@foliomind/contracts";
import { createDb } from "@foliomind/db";
import { describeDatabaseUrl, migrationDatabaseUrl } from "@foliomind/db/migrate";
import { deliverPending, requeueStalledIngestion } from "@foliomind/domain";
import { createInngest } from "@foliomind/workflows";

async function main(): Promise<void> {
  const send = process.argv.includes("--send");
  const url = migrationDatabaseUrl();
  console.log(`Database: ${describeDatabaseUrl(url)}`);
  const { db, close } = createDb({ url, role: "script" });
  try {
    const keys = await requeueStalledIngestion(db);
    console.log(`Re-queued ${keys.length} ingestion job(s).`);
    if (keys.length === 0 || !send) {
      if (keys.length > 0) console.log("Worker A's dispatch-outbox sweep will deliver them.");
      return;
    }
    const inngest = createInngest({
      appId: "foliomind-web",
      isDev: process.env.INNGEST_DEV === "1",
      eventKey: process.env.INNGEST_EVENT_KEY,
      baseUrl: process.env.INNGEST_BASE_URL,
    });
    const result = await deliverPending(db, (events) => inngest.send(events), { keys });
    console.log(
      `Delivered ${result.delivered}, failed ${result.failed} (${resolveAppEnv(process.env)}).`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
