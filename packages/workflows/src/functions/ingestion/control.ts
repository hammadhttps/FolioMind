import {
  createNotification,
  deliverPending,
  expireAbandoned,
  expireUploadIntents,
  filesToDelete,
  markAssetsDeleted,
  purgeDeletedDocuments,
  purgeOldIntents,
  purgeOldNotifications,
  queueStalePendingAssets,
  unknownFileKeys,
} from "@foliomind/domain";
import { cron, type Inngest } from "inngest";
import { notificationCreated } from "../../events";
import { controlConcurrency, type WorkerADeps } from "./shared";

/*
 * Worker A's control functions (blueprint Section 9). They share one
 * concurrency key so they keep running during an ingestion, and each works in
 * bounded batches.
 */

/** In-app notification (push was dropped by the user on 2026-11-04). */
export function createSendNotificationFunction(inngest: Inngest, deps: WorkerADeps) {
  return inngest.createFunction(
    {
      id: "send-notification",
      name: "Send notification",
      triggers: [notificationCreated],
      retries: 3,
      idempotency: "event.data.operationKey",
      concurrency: controlConcurrency(deps.concurrency.control),
    },
    async ({ event, step }) =>
      step.run("write-notification", () =>
        createNotification(deps.db, {
          userId: event.data.userId,
          type: event.data.type,
          subjectId: event.data.subjectId,
          eventKey: event.data.operationKey,
        }),
      ),
  );
}

/** Re-sends outbox rows the web app could not deliver right after commit (Section 3). */
export function createDispatchOutboxFunction(inngest: Inngest, deps: WorkerADeps) {
  return inngest.createFunction(
    {
      id: "dispatch-outbox",
      name: "Dispatch outbox",
      triggers: [cron(deps.outboxCron)],
      retries: 3,
      // One sweep at a time, inside the shared control limit.
      concurrency: [{ limit: 1 }, controlConcurrency(deps.concurrency.control)],
    },
    async ({ step }) => {
      let delivered = 0;
      let failed = 0;
      // Bounded: at most five batches of 100 per run.
      for (let round = 1; round <= 5; round += 1) {
        const result = await step.run(`deliver-${round}`, () =>
          deliverPending(deps.db, (events) => inngest.send(events), { limit: 100 }),
        );
        delivered += result.delivered;
        failed += result.failed;
        if (result.delivered + result.failed < 100 || result.failed > 0) break;
      }
      if (delivered + failed > 0) deps.logger.info({ delivered, failed }, "outbox dispatched");
      return { delivered, failed };
    },
  );
}

/** Daily maintenance at 03:30 UTC (Sections 9, 12 and 25). */
export function createCleanupMaintenanceFunction(inngest: Inngest, deps: WorkerADeps) {
  const { db, files } = deps;
  return inngest.createFunction(
    {
      id: "cleanup-maintenance",
      name: "Cleanup and maintenance",
      triggers: [cron("TZ=UTC 30 3 * * *")],
      retries: 3,
      concurrency: [{ limit: 1 }, controlConcurrency(deps.concurrency.control)],
    },
    async ({ step }) => {
      const intents = await step.run("expire-upload-intents", () => expireUploadIntents(db));
      const reservations = await step.run(
        "expire-reservations",
        async () => (await expireAbandoned(db)).length,
      );
      const purged = await step.run("purge-deleted-documents", async () => {
        const totals = { documents: 0, chunks: 0, pages: 0 };
        for (let round = 0; round < 8; round += 1) {
          const batch = await purgeDeletedDocuments(db, { limit: 25 });
          totals.documents += batch.documents;
          totals.chunks += batch.chunks;
          totals.pages += batch.pages;
          if (batch.documents < 25) break;
        }
        return totals;
      });
      const staleAssets = await step.run("queue-stale-pending-assets", () =>
        queueStalePendingAssets(db),
      );
      const removedFiles = await step.run("delete-files", async () => {
        let removed = 0;
        for (let round = 0; round < 10; round += 1) {
          const keys = await filesToDelete(db, { limit: 100 });
          if (keys.length === 0) break;
          if (!(await files.delete(keys))) break;
          await markAssetsDeleted(db, keys);
          removed += keys.length;
          if (keys.length < 100) break;
        }
        return removed;
      });
      const orphanFiles = await step.run("orphan-files", async () => {
        // Only where one UploadThing app serves one environment (Section 25).
        if (!deps.orphanFileSweep) return 0;
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        let removed = 0;
        for (let offset = 0; offset < 5000; offset += 500) {
          const stored = await files.list({ limit: 500, offset });
          const old = stored.filter((file) => file.uploadedAt.getTime() < dayAgo).map((f) => f.key);
          const orphans = await unknownFileKeys(db, old);
          if (orphans.length > 0 && (await files.delete(orphans))) removed += orphans.length;
          if (stored.length < 500) break;
        }
        return removed;
      });
      const notifications = await step.run("notification-retention", () =>
        purgeOldNotifications(db),
      );
      const oldIntents = await step.run("intent-retention", () => purgeOldIntents(db));
      const summary = {
        intents,
        reservations,
        purged,
        staleAssets,
        removedFiles,
        orphanFiles,
        notifications,
        oldIntents,
      };
      deps.logger.info(summary, "maintenance finished");
      return summary;
    },
  );
}
