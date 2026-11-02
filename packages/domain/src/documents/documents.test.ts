import { randomUUID } from "node:crypto";
import { MAX_SOURCE_PDF_BYTES } from "@foliomind/contracts";
import {
  assets,
  documents,
  documentVersions,
  jobs,
  libraryItems,
  outboxEvents,
  uploadIntents,
} from "@foliomind/db";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import {
  completeSourceUpload,
  deleteDocument,
  getReadableDocument,
  ingestOperationKey,
  markAssetsDeleted,
  prepareSourceUpload,
  renameDocument,
} from ".";

const pdf = (size = 50_000) => ({ name: "Field Notes.pdf", size, type: "application/pdf" });
const embedding = { model: "jina-embeddings-v5-text-small", dimension: 1024 };
const acl = "public" as const;
const actor = (user: { id: string; status: "active" | "suspended" | "deleting" }) => ({
  id: user.id,
  status: user.status,
});

async function admitted(userId: string) {
  const admission = await prepareSourceUpload(testDb(), { userId, files: [pdf()] });
  if (!admission.ok) throw new Error(`refused: ${admission.code}`);
  return admission;
}

const stored = (customId: string, size = 50_000) => ({
  key: `ut-${randomUUID()}`,
  name: "Field Notes.pdf",
  size,
  type: "application/pdf",
  customId,
});

describeWithDatabase("prepareSourceUpload", () => {
  it("records an expiring intent whose ID becomes the file's customId", async () => {
    const user = await createUser(testDb());
    const admission = await admitted(user.id);
    const [intent] = await testDb()
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.id, admission.intentId));
    expect(intent).toMatchObject({
      customId: admission.intentId,
      userId: user.id,
      status: "issued",
      maxBytes: MAX_SOURCE_PDF_BYTES,
    });
    expect(intent!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses non-PDFs, oversized files, several files and inactive accounts", async () => {
    const db = testDb();
    const user = await createUser(db);
    const suspended = await createUser(db, { status: "suspended" });
    const files = (list: { name: string; size: number; type: string }[]) =>
      prepareSourceUpload(db, { userId: user.id, files: list });

    expect(await files([{ name: "notes.txt", size: 10, type: "text/plain" }])).toEqual({
      ok: false,
      code: "not_pdf",
    });
    expect(await files([pdf(MAX_SOURCE_PDF_BYTES + 1)])).toEqual({
      ok: false,
      code: "file_too_large",
    });
    expect(await files([pdf(), pdf()])).toEqual({ ok: false, code: "one_file" });
    expect(await prepareSourceUpload(db, { userId: suspended.id, files: [pdf()] })).toEqual({
      ok: false,
      code: "account_inactive",
    });
  });

  it("enforces the file and storage allowances (Free: 5 PDFs, 100 MiB)", async () => {
    const db = testDb();
    const full = await createUser(db);
    for (let n = 0; n < 5; n += 1) await createDocument(db, full.id);
    expect(await prepareSourceUpload(db, { userId: full.id, files: [pdf()] })).toEqual({
      ok: false,
      code: "file_limit",
    });

    const heavy = await createUser(db);
    await db.insert(assets).values({
      ownerId: heavy.id,
      fileKey: `big-${randomUUID()}`,
      customId: `big-${randomUUID()}`,
      fileRoute: "sourcePdf",
      acl: "private",
      purpose: "export",
      bytes: 100 * 1024 * 1024 - 1000,
      mimeType: "application/pdf",
      state: "ready",
    });
    expect(await prepareSourceUpload(db, { userId: heavy.id, files: [pdf()] })).toEqual({
      ok: false,
      code: "storage_limit",
    });
  });

  it("counts deleted documents toward the daily admission limit", async () => {
    const db = testDb();
    const user = await createUser(db);
    for (let n = 0; n < 10; n += 1) {
      const { document } = await createDocument(db, user.id);
      await deleteDocument(db, actor(user), document.id);
    }
    expect(await prepareSourceUpload(db, { userId: user.id, files: [pdf()] })).toEqual({
      ok: false,
      code: "daily_limit",
    });
  });
});

describeWithDatabase("completeSourceUpload", () => {
  it("creates every record and one outbox event atomically, once", async () => {
    const db = testDb();
    const user = await createUser(db);
    const admission = await admitted(user.id);
    const file = stored(admission.customId);

    const first = await completeSourceUpload(db, { userId: user.id, file, embedding, acl });
    expect(first).toMatchObject({ ok: true, created: true });
    if (!first.ok) return;
    expect(first.eventKey).toBe(ingestOperationKey(first.versionId));

    const replay = await completeSourceUpload(db, { userId: user.id, file, embedding, acl });
    expect(replay).toEqual({
      ok: true,
      documentId: first.documentId,
      versionId: first.versionId,
      eventKey: null,
      created: false,
    });

    const [document] = await db.select().from(documents).where(eq(documents.id, first.documentId));
    expect(document).toMatchObject({
      title: "Field Notes",
      sourceKind: "upload",
      status: "active",
      currentVersionId: first.versionId,
    });
    const [version] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, first.versionId));
    expect(version).toMatchObject({ status: "queued", sha256: null, embeddingDimension: 1024 });
    const [asset] = await db.select().from(assets).where(eq(assets.id, version!.assetId));
    expect(asset).toMatchObject({
      fileKey: file.key,
      acl: "public",
      purpose: "source",
      bytes: 50_000,
    });
    expect(
      await db.select().from(libraryItems).where(eq(libraryItems.documentId, first.documentId)),
    ).toHaveLength(1);
    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, first.eventKey!));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ topic: "document/version.uploaded" });
    const [job] = await db.select().from(jobs).where(eq(jobs.operationKey, first.eventKey!));
    expect(job).toMatchObject({
      kind: "ingest-document",
      status: "queued",
      targetId: first.versionId,
    });
    const [intent] = await db
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.id, admission.intentId));
    expect(intent).toMatchObject({ status: "completed", assetId: asset!.id });
  });

  it("uses the title given with the upload", async () => {
    const db = testDb();
    const user = await createUser(db);
    const admission = await admitted(user.id);
    const result = await completeSourceUpload(db, {
      userId: user.id,
      file: stored(admission.customId),
      title: "My chosen title",
      embedding,
      acl,
    });
    if (!result.ok) throw new Error(result.code);
    const [document] = await db.select().from(documents).where(eq(documents.id, result.documentId));
    expect(document?.title).toBe("My chosen title");
  });

  it("refuses unknown, foreign, expired, reused and oversized intents", async () => {
    const db = testDb();
    const user = await createUser(db);
    const other = await createUser(db);

    expect(
      await completeSourceUpload(db, {
        userId: user.id,
        file: stored(randomUUID()),
        embedding,
        acl,
      }),
    ).toEqual({ ok: false, code: "intent_not_found" });

    const foreign = await admitted(other.id);
    expect(
      await completeSourceUpload(db, {
        userId: user.id,
        file: stored(foreign.customId),
        embedding,
        acl,
      }),
    ).toEqual({ ok: false, code: "wrong_owner" });

    const late = await admitted(user.id);
    expect(
      await completeSourceUpload(db, {
        userId: user.id,
        file: stored(late.customId),
        embedding,
        acl,
        now: new Date(Date.now() + 31 * 60 * 1000),
      }),
    ).toEqual({ ok: false, code: "intent_expired" });

    const big = await admitted(user.id);
    expect(
      await completeSourceUpload(db, {
        userId: user.id,
        file: stored(big.customId, MAX_SOURCE_PDF_BYTES + 1),
        embedding,
        acl,
      }),
    ).toEqual({ ok: false, code: "file_too_large" });
    // A refused intent cannot be used again.
    expect(
      await completeSourceUpload(db, {
        userId: user.id,
        file: stored(big.customId),
        embedding,
        acl,
      }),
    ).toEqual({ ok: false, code: "intent_expired" });

    const used = await admitted(user.id);
    expect(
      (
        await completeSourceUpload(db, {
          userId: user.id,
          file: stored(used.customId),
          embedding,
          acl,
        })
      ).ok,
    ).toBe(true);
    expect(
      await completeSourceUpload(db, {
        userId: user.id,
        file: stored(used.customId),
        embedding,
        acl,
      }),
    ).toEqual({ ok: false, code: "intent_used" });
  });

  it("re-checks the file allowance at completion so parallel uploads cannot overshoot", async () => {
    const db = testDb();
    const user = await createUser(db);
    for (let n = 0; n < 3; n += 1) await createDocument(db, user.id);
    // Three uploads admitted while only two slots remain.
    const admissions = await Promise.all([admitted(user.id), admitted(user.id), admitted(user.id)]);
    const results = await Promise.all(
      admissions.map((admission) =>
        completeSourceUpload(db, {
          userId: user.id,
          file: stored(admission.customId),
          embedding,
          acl,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: "file_limit" }]);
  });
});

describeWithDatabase("document access and lifecycle", () => {
  it("lets only the owner open, rename and delete; deletion revokes access at once", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const { document, asset } = await createDocument(db, owner.id);

    expect(await getReadableDocument(db, actor(owner), document.id)).toMatchObject({
      id: document.id,
      isOwner: true,
      asset: { fileKey: asset.fileKey },
    });
    expect(await getReadableDocument(db, actor(stranger), document.id)).toBeNull();
    expect(await getReadableDocument(db, null, document.id)).toBeNull();

    expect(await renameDocument(db, actor(stranger), document.id, "Hijacked")).toBe(false);
    expect(await renameDocument(db, actor(owner), document.id, "Renamed")).toBe(true);
    expect(await deleteDocument(db, actor(stranger), document.id)).toBeNull();

    expect(await deleteDocument(db, actor(owner), document.id)).toEqual({
      fileKeys: [asset.fileKey],
    });
    expect(await getReadableDocument(db, actor(owner), document.id)).toBeNull();
    const [after] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(after?.state).toBe("deleting");
    expect(await deleteDocument(db, actor(owner), document.id)).toBeNull();

    await markAssetsDeleted(db, [asset.fileKey]);
    const [purged] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(purged?.state).toBe("deleted");
  });
});
