import { randomUUID } from "node:crypto";
import {
  DAILY_SOURCE_ADMISSIONS,
  EVENT_NAMES,
  INDEX_VERSION,
  MAX_SOURCE_PDF_BYTES,
  UPLOAD_INTENT_TTL_MS,
  type UploadRefusalCode,
} from "@foliomind/contracts";
import {
  assets,
  documents,
  documentVersions,
  jobs,
  libraryItems,
  uploadIntents,
  users,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, gte, inArray, not, sql } from "drizzle-orm";
import { readableSources, type Actor } from "../access";
import { currentEntitlement } from "../entitlements";
import { enqueue } from "../outbox";
import { isBookSourceDocument } from "../publishing/records";
import { ownedSourceCount, storageBytesUsed } from "../usage";

/*
 * Private source documents (blueprint Sections 3, 10, 11 and 25). An upload is
 * admitted by `prepareSourceUpload` (UploadThing route middleware), and only
 * `completeSourceUpload` (the server-side completion callback) creates records:
 * asset, document, version, library item, job and outbox event in one
 * transaction. The browser's own success callback never creates anything.
 */

export const PDF_MIME_TYPE = "application/pdf";

/** The job and outbox key for a version's ingestion; also the Inngest event ID. */
export const ingestOperationKey = (versionId: string) => `ingest-document:${versionId}`;

export interface DeclaredFile {
  name: string;
  size: number;
  type: string;
}

export type UploadAdmission =
  | { ok: true; intentId: string; customId: string; expiresAt: Date }
  | { ok: false; code: UploadRefusalCode };

function isPdf(file: { name: string; type: string }): boolean {
  // The browser's type is a hint only; Worker A checks the %PDF- signature (Section 25).
  return file.type === PDF_MIME_TYPE || (file.type === "" && /\.pdf$/i.test(file.name));
}

async function dailyAdmissions(db: Executor, userId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(documents)
    .where(
      and(
        eq(documents.ownerId, userId),
        gte(documents.createdAt, since),
        not(isBookSourceDocument(documents.id)),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Upload middleware checks (Section 25): an active account, one PDF within the
 * size limit, the owned-file and storage allowances, and the daily admission
 * limit. On success an expiring intent is recorded; its ID becomes the file's
 * UploadThing customId.
 */
export async function prepareSourceUpload(
  db: Database,
  input: { userId: string; files: readonly DeclaredFile[]; now?: Date },
): Promise<UploadAdmission> {
  const now = input.now ?? new Date();
  const [file, ...rest] = input.files;
  if (!file || rest.length > 0) return { ok: false, code: "one_file" };
  if (!isPdf(file)) return { ok: false, code: "not_pdf" };
  if (file.size > MAX_SOURCE_PDF_BYTES) return { ok: false, code: "file_too_large" };

  const [user] = await db
    .select({ status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, input.userId));
  if (!user || user.status !== "active" || user.deletedAt) {
    return { ok: false, code: "account_inactive" };
  }

  const { planCode, limits } = await currentEntitlement(db, input.userId, now);
  if ((await ownedSourceCount(db, input.userId)) >= limits.ownedSourcePdfs) {
    return { ok: false, code: "file_limit" };
  }
  if ((await storageBytesUsed(db, input.userId)) + file.size > limits.storageBytes) {
    return { ok: false, code: "storage_limit" };
  }
  if ((await dailyAdmissions(db, input.userId, now)) >= DAILY_SOURCE_ADMISSIONS[planCode]) {
    return { ok: false, code: "daily_limit" };
  }

  const intentId = randomUUID();
  const expiresAt = new Date(now.getTime() + UPLOAD_INTENT_TTL_MS);
  await db.insert(uploadIntents).values({
    id: intentId,
    userId: input.userId,
    fileRoute: "sourcePdf",
    customId: intentId,
    maxBytes: MAX_SOURCE_PDF_BYTES,
    expiresAt,
  });
  return { ok: true, intentId, customId: intentId, expiresAt };
}

export interface UploadedFile {
  key: string;
  name: string;
  size: number;
  type: string;
  customId: string | null;
}

export interface EmbeddingConfig {
  model: string;
  dimension: number;
}

export type UploadCompletion =
  | {
      ok: true;
      documentId: string;
      versionId: string;
      /** Outbox key to deliver after commit; null when this call only replayed. */
      eventKey: string | null;
      created: boolean;
    }
  | {
      ok: false;
      code:
        | "intent_not_found"
        | "wrong_owner"
        | "intent_used"
        | "intent_expired"
        | "file_too_large"
        | "not_pdf"
        | "file_limit"
        | "storage_limit";
    };

class CompletionRefused extends Error {
  constructor(readonly code: Extract<UploadCompletion, { ok: false }>["code"]) {
    super(code);
  }
}

function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .trim();
  return (base || "Untitled document").slice(0, 200);
}

/**
 * The upload completion callback (Section 25). Verifies the intent (owner,
 * unexpired, unused) and the stored file's size and type, re-checks the
 * allowances under a per-user lock, then creates every record and the outbox
 * event in one transaction. Calling it again for the same file returns the
 * existing document and enqueues nothing new.
 */
export async function completeSourceUpload(
  db: Database,
  input: {
    userId: string;
    file: UploadedFile;
    title?: string;
    embedding: EmbeddingConfig;
    /** How the file is stored on UploadThing (the free plan has public files only). */
    acl: "public" | "private";
    now?: Date;
  },
): Promise<UploadCompletion> {
  const now = input.now ?? new Date();
  const { file } = input;
  if (!file.customId) return { ok: false, code: "intent_not_found" };

  try {
    return await db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(uploadIntents)
        .where(eq(uploadIntents.customId, file.customId!))
        .for("update");
      if (!intent) throw new CompletionRefused("intent_not_found");
      if (intent.userId !== input.userId) throw new CompletionRefused("wrong_owner");

      if (intent.status === "completed") {
        // A repeated callback for the same stored file: report the original result.
        if (!intent.assetId) throw new CompletionRefused("intent_used");
        const [previous] = await tx
          .select({ documentId: documents.id, versionId: documentVersions.id })
          .from(assets)
          .innerJoin(documentVersions, eq(documentVersions.assetId, assets.id))
          .innerJoin(documents, eq(documents.id, documentVersions.documentId))
          .where(and(eq(assets.id, intent.assetId), eq(assets.fileKey, file.key)));
        if (!previous) throw new CompletionRefused("intent_used");
        return { ok: true, ...previous, eventKey: null, created: false } as const;
      }
      if (intent.status !== "issued" || intent.expiresAt < now) {
        throw new CompletionRefused("intent_expired");
      }
      if (file.size > Math.min(intent.maxBytes, MAX_SOURCE_PDF_BYTES)) {
        throw new CompletionRefused("file_too_large");
      }
      if (!isPdf(file)) throw new CompletionRefused("not_pdf");

      // Serialize this user's completions so parallel uploads cannot overshoot.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
      const { limits } = await currentEntitlement(tx, input.userId, now);
      if ((await ownedSourceCount(tx, input.userId)) >= limits.ownedSourcePdfs) {
        throw new CompletionRefused("file_limit");
      }
      if ((await storageBytesUsed(tx, input.userId)) + file.size > limits.storageBytes) {
        throw new CompletionRefused("storage_limit");
      }

      const [asset] = await tx
        .insert(assets)
        .values({
          ownerId: input.userId,
          fileKey: file.key,
          customId: intent.customId,
          fileRoute: "sourcePdf",
          acl: input.acl,
          purpose: "source",
          bytes: file.size,
          mimeType: PDF_MIME_TYPE,
          state: "ready",
        })
        .returning({ id: assets.id });
      const [document] = await tx
        .insert(documents)
        .values({
          ownerId: input.userId,
          title: input.title ?? titleFromFileName(file.name),
          sourceKind: "upload",
        })
        .returning({ id: documents.id });
      if (!asset || !document) throw new Error("Upload records were not created");

      const [version] = await tx
        .insert(documentVersions)
        .values({
          documentId: document.id,
          versionNo: 1,
          assetId: asset.id,
          status: "queued",
          indexVersion: INDEX_VERSION,
          embeddingModel: input.embedding.model,
          embeddingDimension: input.embedding.dimension,
        })
        .returning({ id: documentVersions.id });
      if (!version) throw new Error("Document version was not created");
      await tx
        .update(documents)
        .set({ currentVersionId: version.id })
        .where(eq(documents.id, document.id));
      await tx.insert(libraryItems).values({ userId: input.userId, documentId: document.id });

      const operationKey = ingestOperationKey(version.id);
      const [job] = await tx
        .insert(jobs)
        .values({
          ownerId: input.userId,
          kind: "ingest-document",
          targetId: version.id,
          operationKey,
        })
        .returning({ id: jobs.id });
      if (!job) throw new Error("Ingestion job was not created");
      await enqueue(tx, {
        key: operationKey,
        name: EVENT_NAMES.documentVersionUploaded,
        data: {
          documentId: document.id,
          versionId: version.id,
          ownerId: input.userId,
          jobId: job.id,
          operationKey,
        },
      });
      await tx
        .update(uploadIntents)
        .set({ status: "completed", assetId: asset.id })
        .where(eq(uploadIntents.id, intent.id));

      return {
        ok: true,
        documentId: document.id,
        versionId: version.id,
        eventKey: operationKey,
        created: true,
      } as const;
    });
  } catch (error) {
    if (!(error instanceof CompletionRefused)) throw error;
    // A refused file must not be retried against the same intent.
    if (error.code !== "intent_not_found" && error.code !== "wrong_owner") {
      await db
        .update(uploadIntents)
        .set({ status: "expired" })
        .where(and(eq(uploadIntents.customId, file.customId), eq(uploadIntents.status, "issued")));
    }
    return { ok: false, code: error.code };
  }
}

/** Rename a document the actor owns (Section 11: metadata update). */
export async function renameDocument(
  db: Executor,
  actor: Actor,
  documentId: string,
  title: string,
): Promise<boolean> {
  if (actor.status !== "active") return false;
  const updated = await db
    .update(documents)
    .set({ title })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.ownerId, actor.id),
        eq(documents.status, "active"),
      ),
    )
    .returning({ id: documents.id });
  return updated.length > 0;
}

/**
 * Soft revoke (Section 11): access and retrieval stop at once because every
 * read checks `documents.status`. Assets move to `deleting`; the caller removes
 * the stored files (or the Phase 6 cleanup does). The library entry and its
 * collection memberships go now. Returns the revoked files' keys, or null when
 * the actor cannot delete the document.
 */
export async function deleteDocument(
  db: Database,
  actor: Actor,
  documentId: string,
): Promise<{ fileKeys: string[] } | null> {
  if (actor.status !== "active") return null;
  return db.transaction(async (tx) => {
    const [document] = await tx
      .update(documents)
      .set({ status: "deleting", deletedAt: new Date() })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.ownerId, actor.id),
          eq(documents.status, "active"),
        ),
      )
      .returning({ id: documents.id });
    if (!document) return null;

    const versionAssets = tx
      .select({ assetId: documentVersions.assetId })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId));
    const revoked = await tx
      .update(assets)
      .set({ state: "deleting" })
      .where(and(inArray(assets.id, versionAssets), inArray(assets.state, ["pending", "ready"])))
      .returning({ fileKey: assets.fileKey });
    await tx.delete(libraryItems).where(eq(libraryItems.documentId, documentId));
    return { fileKeys: revoked.map((row) => row.fileKey) };
  });
}

/** Files removed from storage: their assets are now `deleted` (Section 25 cleanup). */
export async function markAssetsDeleted(db: Executor, fileKeys: readonly string[]): Promise<void> {
  if (fileKeys.length === 0) return;
  await db
    .update(assets)
    .set({ state: "deleted" })
    .where(and(inArray(assets.fileKey, [...fileKeys]), eq(assets.state, "deleting")));
}

export interface ReadableDocument {
  id: string;
  title: string;
  ownerId: string;
  sourceKind: "upload" | "url_import";
  isOwner: boolean;
  version: { id: string; status: string; pageCount: number | null };
  asset: { fileKey: string; state: string };
}

/**
 * The current version of a document the actor may read (ownership or an
 * active published revision), or null; callers answer 404 either way so a
 * document's existence is never revealed.
 */
export async function getReadableDocument(
  db: Executor,
  actor: Actor | null,
  documentId: string,
): Promise<ReadableDocument | null> {
  if (!actor) return null;
  const [row] = await db
    .select({
      id: documents.id,
      title: documents.title,
      ownerId: documents.ownerId,
      sourceKind: documents.sourceKind,
      status: documents.status,
      versionId: documentVersions.id,
      versionStatus: documentVersions.status,
      pageCount: documentVersions.pageCount,
      fileKey: assets.fileKey,
      assetState: assets.state,
    })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .innerJoin(assets, eq(assets.id, documentVersions.assetId))
    .where(eq(documents.id, documentId));
  if (!row || row.status !== "active" || row.assetState !== "ready") return null;
  const [source] = await readableSources(db, actor, [row.versionId]);
  if (!source) return null;
  return {
    id: row.id,
    // A reader of a catalog book sees its listing title, not the publisher's file name.
    title: source.title,
    ownerId: row.ownerId,
    sourceKind: row.sourceKind,
    isOwner: row.ownerId === actor.id,
    version: { id: row.versionId, status: row.versionStatus, pageCount: row.pageCount },
    asset: { fileKey: row.fileKey, state: row.assetState },
  };
}
