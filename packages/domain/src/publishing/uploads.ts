import { randomUUID } from "node:crypto";
import {
  COVER_IMAGE_TYPES,
  EVENT_NAMES,
  INDEX_VERSION,
  MAX_COVER_BYTES,
  MAX_SOURCE_PDF_BYTES,
  PUBLISHER_DAILY_UPLOADS,
  PUBLISHER_STORAGE_BYTES,
  UPLOAD_INTENT_TTL_MS,
  type BookUploadRefusalCode,
} from "@foliomind/contracts";
import {
  assets,
  bookRevisions,
  books,
  documents,
  documentVersions,
  jobs,
  uploadIntents,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, sql } from "drizzle-orm";
import {
  ingestOperationKey,
  PDF_MIME_TYPE,
  type DeclaredFile,
  type EmbeddingConfig,
  type UploadedFile,
} from "../documents";
import { enqueue } from "../outbox";
import {
  approvedPublisherFor,
  bookFileBytesUsed,
  getOwnedBook,
  openRevision,
  recentBookUploads,
  releaseUnusedBookFiles,
} from "./records";

/*
 * Book files (blueprint Section 25 `bookSourcePdf` and `coverImage`). The
 * middleware admits an upload for a book the publisher owns and records an
 * expiring intent; only the server-side completion creates records. A source
 * becomes a new document with its own version and ingestion job and is
 * attached to the book's draft revision; a cover attaches to the draft too.
 * Neither is live until a moderator approves the revision (Section 6).
 */

export type BookFileKind = "source" | "cover";

const ROUTE: Record<BookFileKind, "bookSourcePdf" | "coverImage"> = {
  source: "bookSourcePdf",
  cover: "coverImage",
};

const isPdf = (file: { name: string; type: string }) =>
  file.type === PDF_MIME_TYPE || (file.type === "" && /\.pdf$/i.test(file.name));
const isCoverImage = (type: string) => (COVER_IMAGE_TYPES as readonly string[]).includes(type);

export type BookUploadAdmission =
  { ok: true; customId: string } | { ok: false; code: BookUploadRefusalCode };

/** Checks shared by admission and completion; the book row is locked when `lock` is set. */
async function checkBook(
  db: Executor,
  input: { userId: string; bookId: string; kind: BookFileKind; size: number; now: Date },
  lock: boolean,
): Promise<{ ok: true; publisherId: string } | { ok: false; code: BookUploadRefusalCode }> {
  const publisher = await approvedPublisherFor(db, { id: input.userId, status: "active" });
  if (!publisher) return { ok: false, code: "not_publisher" };
  const book = await getOwnedBook(db, publisher.id, input.bookId, { lock });
  if (!book) return { ok: false, code: "not_found" };
  if (book.status === "removed") return { ok: false, code: "removed" };
  const open = await openRevision(db, book.id);
  if (open?.status === "pending") return { ok: false, code: "pending" };
  if (input.kind === "cover" && !open) return { ok: false, code: "no_source" };
  if (!open && input.kind === "source") {
    // A first source creates revision 1; later ones need "Revise" first.
    const [any] = await db.execute<{ exists: boolean }>(
      sql`select exists (select 1 from book_revisions where book_id = ${book.id}) as exists`,
    );
    if (any?.exists) return { ok: false, code: "nothing_to_revise" };
  }
  if ((await bookFileBytesUsed(db, input.userId)) + input.size > PUBLISHER_STORAGE_BYTES) {
    return { ok: false, code: "storage_limit" };
  }
  if ((await recentBookUploads(db, input.userId, input.now)) >= PUBLISHER_DAILY_UPLOADS) {
    return { ok: false, code: "daily_limit" };
  }
  return { ok: true, publisherId: publisher.id };
}

/** UploadThing middleware for both book routes: an approved publisher who owns the book. */
export async function prepareBookUpload(
  db: Database,
  input: {
    userId: string;
    bookId: string;
    kind: BookFileKind;
    files: readonly DeclaredFile[];
    now?: Date;
  },
): Promise<BookUploadAdmission> {
  const now = input.now ?? new Date();
  const [file, ...rest] = input.files;
  if (!file || rest.length > 0) return { ok: false, code: "one_file" };
  if (input.kind === "source") {
    if (!isPdf(file)) return { ok: false, code: "not_pdf" };
    if (file.size > MAX_SOURCE_PDF_BYTES) return { ok: false, code: "file_too_large" };
  } else if (!isCoverImage(file.type) || file.size > MAX_COVER_BYTES) {
    return { ok: false, code: "not_image" };
  }
  const checked = await checkBook(
    db,
    { userId: input.userId, bookId: input.bookId, kind: input.kind, size: file.size, now },
    false,
  );
  if (!checked.ok) return checked;

  const intentId = randomUUID();
  await db.insert(uploadIntents).values({
    id: intentId,
    userId: input.userId,
    fileRoute: ROUTE[input.kind],
    customId: intentId,
    maxBytes: input.kind === "source" ? MAX_SOURCE_PDF_BYTES : MAX_COVER_BYTES,
    expiresAt: new Date(now.getTime() + UPLOAD_INTENT_TTL_MS),
  });
  return { ok: true, customId: intentId };
}

class Refused extends Error {
  constructor(readonly code: BookUploadRefusalCode) {
    super(code);
  }
}

/** Locks and verifies the intent behind a stored file (owner, route, unexpired, unused, size). */
async function claimIntent(
  tx: Executor,
  input: { userId: string; kind: BookFileKind; file: UploadedFile; now: Date },
) {
  if (!input.file.customId) throw new Refused("upload_expired");
  const [intent] = await tx
    .select()
    .from(uploadIntents)
    .where(eq(uploadIntents.customId, input.file.customId))
    .for("update");
  if (!intent || intent.userId !== input.userId || intent.fileRoute !== ROUTE[input.kind]) {
    throw new Refused("upload_expired");
  }
  if (intent.status !== "issued" || intent.expiresAt < input.now)
    throw new Refused("upload_expired");
  if (input.file.size > intent.maxBytes) {
    throw new Refused(input.kind === "source" ? "file_too_large" : "not_image");
  }
  if (input.kind === "source" ? !isPdf(input.file) : !isCoverImage(input.file.type)) {
    throw new Refused(input.kind === "source" ? "not_pdf" : "not_image");
  }
  return intent;
}

export type BookSourceCompletion =
  | {
      ok: true;
      documentId: string;
      versionId: string;
      revisionId: string;
      /** Outbox key to deliver after commit. */
      eventKey: string;
      /** Files of a replaced source that no revision uses anymore. */
      fileKeys: string[];
    }
  | { ok: false; code: BookUploadRefusalCode };

function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, "")
    .replace(/_+/g, " ")
    .trim();
  return (base || "Untitled book").slice(0, 200);
}

/**
 * Completion for `bookSourcePdf`: asset, document, version, ingestion job and
 * outbox event in one transaction, then the book's draft revision points at the
 * new version. The first upload creates revision 1 with the given title.
 */
export async function completeBookSourceUpload(
  db: Database,
  input: {
    userId: string;
    bookId: string;
    title?: string | undefined;
    file: UploadedFile;
    embedding: EmbeddingConfig;
    acl: "public" | "private";
    now?: Date;
  },
): Promise<BookSourceCompletion> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const intent = await claimIntent(tx, { ...input, kind: "source", now });
      const checked = await checkBook(
        tx,
        { userId: input.userId, bookId: input.bookId, kind: "source", size: input.file.size, now },
        true,
      );
      if (!checked.ok) throw new Refused(checked.code);

      const [asset] = await tx
        .insert(assets)
        .values({
          ownerId: input.userId,
          fileKey: input.file.key,
          customId: intent.customId,
          fileRoute: "bookSourcePdf",
          acl: input.acl,
          purpose: "source",
          bytes: input.file.size,
          mimeType: PDF_MIME_TYPE,
          state: "ready",
        })
        .returning({ id: assets.id });
      const [document] = await tx
        .insert(documents)
        .values({
          ownerId: input.userId,
          title: titleFromFileName(input.file.name),
          sourceKind: "upload",
        })
        .returning({ id: documents.id });
      if (!asset || !document) throw new Error("Book source records were not created");
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
      if (!version) throw new Error("Book source version was not created");
      await tx
        .update(documents)
        .set({ currentVersionId: version.id })
        .where(eq(documents.id, document.id));

      // Attach to the draft revision, or start revision 1.
      const open = await openRevision(tx, input.bookId, { lock: true });
      let revisionId: string;
      let fileKeys: string[] = [];
      if (open) {
        const [previous] = await tx.execute<{ document_id: string }>(sql`
          select document_id from document_versions where id = ${open.documentVersionId}`);
        await tx
          .update(bookRevisions)
          .set({ documentVersionId: version.id, updatedAt: sql`now()` })
          .where(eq(bookRevisions.id, open.id));
        revisionId = open.id;
        if (previous) {
          fileKeys = await releaseUnusedBookFiles(tx, {
            documentIds: [previous.document_id],
            coverAssetIds: [],
          });
        }
      } else {
        const [created] = await tx
          .insert(bookRevisions)
          .values({
            bookId: input.bookId,
            revisionNo: 1,
            documentVersionId: version.id,
            title: input.title?.trim() || titleFromFileName(input.file.name),
            description: "",
            author: "",
            language: "en",
            licenseStatement: "",
            status: "draft",
          })
          .returning({ id: bookRevisions.id });
        if (!created) throw new Error("Book revision was not created");
        revisionId = created.id;
      }
      await tx
        .update(books)
        .set({ updatedAt: sql`now()` })
        .where(eq(books.id, input.bookId));

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
        revisionId,
        eventKey: operationKey,
        fileKeys,
      } as const;
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    await expireIntent(db, input.file.customId);
    return { ok: false, code: error.code };
  }
}

export type CoverCompletion =
  { ok: true; revisionId: string; fileKeys: string[] } | { ok: false; code: BookUploadRefusalCode };

/** Completion for `coverImage`: a public asset attached to the draft revision only. */
export async function completeCoverUpload(
  db: Database,
  input: { userId: string; bookId: string; file: UploadedFile; now?: Date },
): Promise<CoverCompletion> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const intent = await claimIntent(tx, { ...input, kind: "cover", now });
      const checked = await checkBook(
        tx,
        { userId: input.userId, bookId: input.bookId, kind: "cover", size: input.file.size, now },
        true,
      );
      if (!checked.ok) throw new Refused(checked.code);
      const open = await openRevision(tx, input.bookId, { lock: true });
      if (!open || open.status !== "draft") throw new Refused("no_source");

      const [asset] = await tx
        .insert(assets)
        .values({
          ownerId: input.userId,
          fileKey: input.file.key,
          customId: intent.customId,
          fileRoute: "coverImage",
          acl: "public",
          purpose: "cover",
          bytes: input.file.size,
          mimeType: input.file.type,
          state: "ready",
        })
        .returning({ id: assets.id });
      if (!asset) throw new Error("Cover asset was not created");
      await tx
        .update(bookRevisions)
        .set({ coverAssetId: asset.id, updatedAt: sql`now()` })
        .where(eq(bookRevisions.id, open.id));
      await tx
        .update(books)
        .set({ updatedAt: sql`now()` })
        .where(eq(books.id, input.bookId));
      const fileKeys = open.coverAssetId
        ? await releaseUnusedBookFiles(tx, { documentIds: [], coverAssetIds: [open.coverAssetId] })
        : [];
      await tx
        .update(uploadIntents)
        .set({ status: "completed", assetId: asset.id })
        .where(eq(uploadIntents.id, intent.id));
      return { ok: true, revisionId: open.id, fileKeys } as const;
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    await expireIntent(db, input.file.customId);
    return { ok: false, code: error.code };
  }
}

async function expireIntent(db: Executor, customId: string | null) {
  if (!customId) return;
  await db
    .update(uploadIntents)
    .set({ status: "expired" })
    .where(and(eq(uploadIntents.customId, customId), eq(uploadIntents.status, "issued")));
}

/** Removes the draft's cover; the file goes once no other revision uses it. */
export async function removeDraftCover(
  db: Database,
  input: { userId: string; bookId: string },
): Promise<{ ok: true; fileKeys: string[] } | { ok: false; code: BookUploadRefusalCode }> {
  return db.transaction(async (tx) => {
    const publisher = await approvedPublisherFor(tx, { id: input.userId, status: "active" });
    if (!publisher) return { ok: false, code: "not_publisher" } as const;
    const book = await getOwnedBook(tx, publisher.id, input.bookId, { lock: true });
    if (!book) return { ok: false, code: "not_found" } as const;
    const open = await openRevision(tx, book.id, { lock: true });
    if (!open || open.status !== "draft") return { ok: false, code: "pending" } as const;
    if (!open.coverAssetId) return { ok: true, fileKeys: [] } as const;
    await tx
      .update(bookRevisions)
      .set({ coverAssetId: null, updatedAt: sql`now()` })
      .where(eq(bookRevisions.id, open.id));
    const fileKeys = await releaseUnusedBookFiles(tx, {
      documentIds: [],
      coverAssetIds: [open.coverAssetId],
    });
    return { ok: true, fileKeys } as const;
  });
}
