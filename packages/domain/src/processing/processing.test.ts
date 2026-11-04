import { randomUUID } from "node:crypto";
import { PLAN_LIMITS } from "@foliomind/contracts";
import {
  assets,
  documentChunks,
  documentPages,
  documents,
  documentVersions,
  jobs,
  libraryItems,
  notifications,
  outboxEvents,
  usageOperations,
  type Database,
} from "@foliomind/db";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  expireUploadIntents,
  filesToDelete,
  purgeDeletedDocuments,
  queueStalePendingAssets,
  unknownFileKeys,
} from "../cleanup";
import { deleteDocument, ingestOperationKey } from "../documents";
import { createSnapshotVersion, failImport, requestReimport, requestUrlImport } from "../imports";
import { activateVersion } from "../ingestion";
import {
  failJob,
  jobErrorCodeFrom,
  JobFailure,
  jobStatusForOwner,
  requestJobCancel,
} from "../jobs";
import { listLibrary } from "../library";
import {
  createNotification,
  dismissNotification,
  listNotifications,
  markNotificationsRead,
  purgeOldNotifications,
  setNotificationPreferences,
  unreadNotificationCount,
} from "../notifications";
import { createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import { requeueStalledIngestion, retryDocument } from "./index";

/* Phase 6 domain services against Postgres. */

async function queuedUpload(db: Database, ownerId: string) {
  const { document, version } = await createDocument(db, ownerId);
  await db
    .update(documentVersions)
    .set({ status: "queued" })
    .where(eq(documentVersions.id, version.id));
  const [job] = await db
    .insert(jobs)
    .values({
      ownerId,
      kind: "ingest-document",
      targetId: version.id,
      operationKey: ingestOperationKey(version.id),
    })
    .returning();
  await db.insert(libraryItems).values({ userId: ownerId, documentId: document.id });
  return { document, version, job: job! };
}

const library = (db: Database, userId: string) =>
  listLibrary(db, { userId, type: "all", status: "all", sort: "added", limit: 50 });

describeWithDatabase("jobs: status, cancel and retry", () => {
  it("shows a job only to its owner", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const { job, document } = await queuedUpload(db, owner.id);
    const status = await jobStatusForOwner(db, owner.id, job.id);
    expect(status).toMatchObject({
      status: "queued",
      phase: "queued",
      canCancel: true,
      documentId: document.id,
    });
    expect(await jobStatusForOwner(db, stranger.id, job.id)).toBeNull();
  });

  it("cancels a live job once, marks the version failed and enqueues the cancellation", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const { job, version } = await queuedUpload(db, owner.id);

    expect(await requestJobCancel(db, stranger.id, job.id)).toBeNull();
    const cancelled = await requestJobCancel(db, owner.id, job.id);
    expect(cancelled?.eventKey).toBe(`cancel:${job.id}`);
    expect(await requestJobCancel(db, owner.id, job.id)).toBeNull();

    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row).toMatchObject({
      status: "cancelled",
      cancelRequested: true,
      safeErrorCode: "cancelled",
    });
    const [versionRow] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id));
    expect(versionRow!.status).toBe("failed");
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, `cancel:${job.id}`));
    expect(event!.topic).toBe("document/version.cancelled");
  });

  it("retries a retryable failure with a new job and key, and refuses permanent ones", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const { job, version, document } = await queuedUpload(db, owner.id);
    expect(await retryDocument(db, { userId: owner.id, documentId: document.id })).toEqual({
      ok: false,
      code: "not_retryable",
    });

    await failJob(db, job.id, "provider_unavailable");
    await db
      .update(documentVersions)
      .set({ status: "failed" })
      .where(eq(documentVersions.id, version.id));
    const retried = await retryDocument(db, { userId: owner.id, documentId: document.id });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.eventKey).toBe(`ingest-document:${version.id}:retry-1`);
    const [versionRow] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id));
    expect(versionRow!.status).toBe("queued");
    // A second retry while the first is queued is refused.
    expect((await retryDocument(db, { userId: owner.id, documentId: document.id })).ok).toBe(false);

    await failJob(db, retried.jobId, "needs_ocr");
    await db
      .update(documentVersions)
      .set({ status: "needs_ocr" })
      .where(eq(documentVersions.id, version.id));
    expect(await retryDocument(db, { userId: owner.id, documentId: document.id })).toEqual({
      ok: false,
      code: "not_retryable",
    });
  });

  it("re-queues ingestion that never started under a new key, once", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const { job, version } = await queuedUpload(db, owner.id);
    const later = new Date(Date.now() + 60_000);
    const keys = await requeueStalledIngestion(db, { olderThan: later });
    const mine = keys.filter((key) => key.startsWith(`ingest-document:${version.id}:requeue-`));
    expect(mine).toHaveLength(1);
    const [old] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(old!.status).toBe("cancelled");
    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, mine[0]!));
    expect(event!.topic).toBe("document/version.uploaded");
    const again = await requeueStalledIngestion(db, { olderThan: new Date(Date.now() - 60_000) });
    expect(again.filter((key) => key.includes(version.id))).toEqual([]);
  });

  it("reads safe codes back from failures", () => {
    expect(jobErrorCodeFrom(new JobFailure("needs_ocr"))).toBe("needs_ocr");
    expect(jobErrorCodeFrom({ name: "NonRetriableError", message: "encrypted_pdf" })).toBe(
      "encrypted_pdf",
    );
    expect(
      jobErrorCodeFrom({ name: "ProviderError", message: "Jina request failed with HTTP 500" }),
    ).toBe("provider_unavailable");
    expect(jobErrorCodeFrom({ name: "TypeError", message: "x is undefined" })).toBe("internal");
  });

  it("shows processing state on library cards", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const { job, document } = await queuedUpload(db, owner.id);
    let [card] = (await library(db, owner.id)).items.filter(
      (item) => item.documentId === document.id,
    );
    expect(card).toMatchObject({ status: "processing", job: { id: job.id, status: "queued" } });

    await failJob(db, job.id, "encrypted_pdf");
    await db
      .update(documentVersions)
      .set({ status: "failed" })
      .where(eq(documentVersions.documentId, document.id));
    [card] = (await library(db, owner.id)).items.filter((item) => item.documentId === document.id);
    expect(card).toMatchObject({ status: "attention", job: { safeErrorCode: "encrypted_pdf" } });
  });
});

describeWithDatabase("notifications", () => {
  it("writes once per event, respects preferences and skips deleted documents", async () => {
    const db = testDb();
    const user = await createUser(db);
    const { document } = await createDocument(db, user.id);
    const input = {
      userId: user.id,
      type: "document_ready" as const,
      subjectId: document.id,
      eventKey: `ready:${randomUUID()}`,
    };

    expect(await createNotification(db, input)).toEqual({ created: true });
    expect(await createNotification(db, input)).toEqual({ created: false });
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventKey, input.eventKey));
    expect(row).toMatchObject({
      title: "Your PDF is ready to read.",
      safeBody: "“Test document” is ready for reading and questions.",
      targetPath: `/read/${document.id}`,
    });

    await setNotificationPreferences(db, user.id, { documents: false });
    expect(await createNotification(db, { ...input, eventKey: `ready:${randomUUID()}` })).toEqual({
      created: false,
      skipped: "preference",
    });
    await setNotificationPreferences(db, user.id, { documents: true });

    await db.update(documents).set({ status: "deleting" }).where(eq(documents.id, document.id));
    expect(await createNotification(db, { ...input, eventKey: `ready:${randomUUID()}` })).toEqual({
      created: false,
      skipped: "subject_gone",
    });

    // Another user's document never produces a notice for this user.
    const stranger = await createUser(db);
    const theirs = await createDocument(db, stranger.id);
    expect(
      (
        await createNotification(db, {
          ...input,
          subjectId: theirs.document.id,
          eventKey: randomUUID(),
        })
      ).created,
    ).toBe(false);
  });

  it("pages newest first, tracks unread, marks read and dismisses", async () => {
    const db = testDb();
    const user = await createUser(db);
    const other = await createUser(db);
    for (let i = 0; i < 5; i += 1) {
      await db.insert(notifications).values({
        userId: user.id,
        eventKey: `n-${i}-${randomUUID()}`,
        type: "document_ready",
        title: `Notice ${i}`,
        safeBody: "Body",
        targetPath: "/dashboard",
        createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)),
      });
    }
    const first = await listNotifications(db, user.id, { limit: 3 });
    expect(first.items.map((item) => item.title)).toEqual(["Notice 4", "Notice 3", "Notice 2"]);
    const second = await listNotifications(db, user.id, { limit: 3, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.title)).toEqual(["Notice 1", "Notice 0"]);
    expect(second.nextCursor).toBeNull();

    expect(await unreadNotificationCount(db, user.id)).toBe(5);
    await markNotificationsRead(db, user.id, [first.items[0]!.id]);
    expect(await unreadNotificationCount(db, user.id)).toBe(4);
    await markNotificationsRead(db, other.id);
    expect(await unreadNotificationCount(db, user.id)).toBe(4);
    await markNotificationsRead(db, user.id);
    expect(await unreadNotificationCount(db, user.id)).toBe(0);

    expect(await dismissNotification(db, other.id, first.items[1]!.id)).toBe(false);
    expect(await dismissNotification(db, user.id, first.items[1]!.id)).toBe(true);
    expect((await listNotifications(db, user.id, { limit: 10 })).items).toHaveLength(4);

    // Retention removes only old notices.
    const purged = await purgeOldNotifications(db, { now: new Date(Date.UTC(2027, 3, 1)) });
    expect(purged).toBeGreaterThanOrEqual(4);
  });
});

describeWithDatabase("web article imports", () => {
  const url = () => new URL(`https://example.com/articles/${randomUUID()}`);

  it("reserves one import, creates a Processing entry, job and outbox event", async () => {
    const db = testDb();
    const user = await createUser(db);
    const result = await requestUrlImport(db, { userId: user.id, url: url() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [document] = await db.select().from(documents).where(eq(documents.id, result.documentId));
    expect(document).toMatchObject({ sourceKind: "url_import", currentVersionId: null });
    const [card] = (await library(db, user.id)).items;
    expect(card).toMatchObject({ kind: "imported", status: "processing", readable: false });
    const [operation] = await db
      .select()
      .from(usageOperations)
      .where(eq(usageOperations.operationKey, result.eventKey));
    expect(operation!.status).toBe("reserved");

    // A failed import returns its reservation and shows as needing attention.
    await failJob(db, result.jobId, "unsupported_page");
    await failImport(db, result.importId, "unsupported_page");
    const [released] = await db
      .select()
      .from(usageOperations)
      .where(eq(usageOperations.operationKey, result.eventKey));
    expect(released!.status).toBe("released");
    const [failedCard] = (await library(db, user.id)).items;
    expect(failedCard).toMatchObject({
      status: "attention",
      job: { safeErrorCode: "unsupported_page" },
    });

    // Retry re-imports the same address as a new job.
    const retried = await retryDocument(db, { userId: user.id, documentId: result.documentId });
    expect(retried.ok).toBe(true);
  });

  it("stops at the monthly allowance and at the owned-document limit", async () => {
    const db = testDb();
    const user = await createUser(db);
    const limit = PLAN_LIMITS.free.urlImportsPerMonth;
    for (let i = 0; i < limit; i += 1) {
      const result = await requestUrlImport(db, { userId: user.id, url: url() });
      expect(result.ok, `import ${i + 1}`).toBe(true);
    }
    expect(await requestUrlImport(db, { userId: user.id, url: url() })).toEqual({
      ok: false,
      code: "quota_exceeded",
    });

    const busy = await createUser(db);
    for (let i = 0; i < PLAN_LIMITS.free.ownedSourcePdfs; i += 1) await createDocument(db, busy.id);
    expect(await requestUrlImport(db, { userId: busy.id, url: url() })).toEqual({
      ok: false,
      code: "file_limit",
    });
    // The refused attempt's reservation was returned.
    const reserved = await db
      .select()
      .from(usageOperations)
      .where(eq(usageOperations.status, "reserved"));
    expect(reserved.every((operation) => !operation.operationKey.includes(busy.id))).toBe(true);
  });

  it("turns a snapshot into a queued version, and a re-import keeps the current version until ready", async () => {
    const db = testDb();
    const user = await createUser(db);
    const first = await requestUrlImport(db, { userId: user.id, url: url() });
    if (!first.ok) throw new Error("import refused");
    const embedding = { model: "test", dimension: 1024 };
    const created = await createSnapshotVersion(db, {
      importId: first.importId,
      jobId: first.jobId,
      userId: user.id,
      documentId: first.documentId,
      title: "Rivers and Banks",
      wordCount: 1200,
      file: { key: `snap-${randomUUID()}`, size: 50_000 },
      acl: "public",
      embedding,
    });
    if ("refused" in created) throw new Error("refused");
    const [document] = await db.select().from(documents).where(eq(documents.id, first.documentId));
    expect(document).toMatchObject({
      title: "Rivers and Banks",
      currentVersionId: created.versionId,
    });
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, created.eventKey));
    expect(event!.topic).toBe("document/version.uploaded");
    const [importJob] = await db.select().from(jobs).where(eq(jobs.id, first.jobId));
    expect(importJob!.status).toBe("succeeded");

    // Re-import while the first is still processing is refused; after it finishes it's allowed.
    const ingestJob = (
      await db.select().from(jobs).where(eq(jobs.operationKey, created.eventKey))
    )[0]!;
    await activateVersion(db, {
      versionId: created.versionId,
      documentId: first.documentId,
      jobId: ingestJob.id,
      result: {},
    });
    const again = await requestReimport(db, { userId: user.id, documentId: first.documentId });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect((await requestReimport(db, { userId: user.id, documentId: first.documentId })).ok).toBe(
      false,
    );
    const second = await createSnapshotVersion(db, {
      importId: again.importId,
      jobId: again.jobId,
      userId: user.id,
      documentId: first.documentId,
      title: "Rivers and Banks, updated",
      wordCount: 1300,
      file: { key: `snap-${randomUUID()}`, size: 50_000 },
      acl: "public",
      embedding,
    });
    if ("refused" in second) throw new Error("refused");
    const [afterReimport] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, first.documentId));
    expect(afterReimport!.currentVersionId).toBe(created.versionId);
    const [version2] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, second.versionId));
    expect(version2!.versionNo).toBe(2);
  });
});

describeWithDatabase("cleanup", () => {
  it("purges a deleted document's text and embeddings and queues its files", async () => {
    const db = testDb();
    const user = await createUser(db);
    const { document, version, asset } = await createDocument(db, user.id);
    await db
      .insert(documentPages)
      .values({ documentVersionId: version.id, pageNumber: 1, text: "Page text" });
    await db.insert(documentChunks).values({
      documentVersionId: version.id,
      chunkIndex: 0,
      pageStart: 1,
      pageEnd: 1,
      text: "Chunk text",
      tokenCount: 3,
      contentHash: "hash",
    });
    const revoked = await deleteDocument(db, { id: user.id, status: "active" }, document.id);
    expect(revoked?.fileKeys).toEqual([asset.fileKey]);

    const purged = await purgeDeletedDocuments(db, { limit: 500 });
    expect(purged.documents).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(documents).where(eq(documents.id, document.id));
    expect(row!.status).toBe("deleted");
    expect(
      await db
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentVersionId, version.id)),
    ).toEqual([]);
    expect(
      await db.select().from(documentPages).where(eq(documentPages.documentVersionId, version.id)),
    ).toEqual([]);
    // The version stays, so citations keep their page and title tombstones.
    expect(
      await db.select().from(documentVersions).where(eq(documentVersions.id, version.id)),
    ).toHaveLength(1);
    expect(await filesToDelete(db, { limit: 1000 })).toContain(asset.fileKey);
  });

  it("expires stale intents, queues stale pending assets and finds unknown files", async () => {
    const db = testDb();
    const user = await createUser(db);
    const [pending] = await db
      .insert(assets)
      .values({
        ownerId: user.id,
        fileKey: `pending-${randomUUID()}`,
        customId: randomUUID(),
        fileRoute: "sourcePdf",
        acl: "public",
        purpose: "source",
        bytes: 10,
        mimeType: "application/pdf",
        state: "pending",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      })
      .returning();
    expect(await queueStalePendingAssets(db)).toBeGreaterThanOrEqual(1);
    const [queued] = await db.select().from(assets).where(eq(assets.id, pending!.id));
    expect(queued!.state).toBe("deleting");
    expect(await unknownFileKeys(db, [pending!.fileKey, "never-stored"])).toEqual(["never-stored"]);
    expect(
      await expireUploadIntents(db, { now: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }),
    ).toBeGreaterThanOrEqual(0);
  });
});
