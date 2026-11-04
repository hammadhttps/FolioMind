import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createJina } from "@foliomind/ai";
import { INDEX_VERSION } from "@foliomind/contracts";
import {
  assets,
  documentChunks,
  documentPages,
  documents,
  documentVersions,
  jobs,
  libraryItems,
  type Database,
} from "@foliomind/db";
import { ingestOperationKey } from "@foliomind/domain";
import { createUser, describeWithDatabase, testDb } from "@foliomind/domain/test/db";
import { InngestTestEngine } from "@inngest/test";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { Inngest } from "inngest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { ExtractionOutcome, Extractor, RawPage } from "../../ingestion/extraction";
import { createIngestDocumentFunction, EMBED_BATCH_SIZE } from "./ingest-document";
import type { FileStore, WorkerADeps } from "./shared";

/*
 * ingest-document against Postgres (Phase 6 tests): a real run produces pages,
 * chunks, embeddings and both indexes; duplicate delivery and same-file
 * uploads add nothing; a failed replacement leaves the previous version
 * active; a resumed run never re-embeds finished batches; a deleted document
 * is never resurrected. Files and Jina are served by MSW; the extractor is a
 * stand-in that turns the stored bytes into known pages.
 */

const DIMENSION = 1024;
const FILES = "https://files.test/f/";

/** Stored "PDFs" by file key: a %PDF- header and the scenario name. */
const stored = new Map<string, string>();
let jinaCalls = 0;
let failJinaCall: number | null = null;

const server = setupServer(
  http.get(`${FILES}:key`, ({ params }) => {
    const body = stored.get(String(params.key));
    return body ? new HttpResponse(body) : new HttpResponse(null, { status: 404 });
  }),
  // Events sent by step.sendEvent go to a stand-in Inngest API.
  http.post("https://inngest.test/e/:key", async ({ request }) => {
    const events = (await request.json()) as unknown[];
    return HttpResponse.json({ ids: events.map(() => randomUUID()), status: 200 });
  }),
  http.post("https://api.jina.ai/v1/embeddings", async ({ request }) => {
    jinaCalls += 1;
    if (failJinaCall === jinaCalls) return new HttpResponse("busy", { status: 503 });
    const body = (await request.json()) as { input: string[]; model: string };
    return HttpResponse.json({
      model: body.model,
      data: body.input.map((text, index) => ({
        index,
        embedding: Array.from({ length: DIMENSION }, (_, d) => ((text.length + d) % 7) / 7 - 0.4),
      })),
      usage: {
        total_tokens: body.input.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
      },
    });
  }),
);

/** Forty pages of distinct prose with a heading each: 40 chunks, two embedding batches. */
const BOOK: RawPage[] = Array.from({ length: 40 }, (_, p) => ({
  pageNumber: p + 1,
  label: null,
  lines: [
    { text: `Chapter ${p + 1}: Notes on reach ${p + 1}`, size: 18, y: 740 },
    ...Array.from({ length: 30 }, (_, l) => ({
      text: `Observation ${p}-${l}: the river bank at reach ${p} shows sediment pattern ${l * 7 + p} and willow growth ${l + p * 3}.`,
      size: 11,
      y: 700 - l * 14,
    })),
  ],
}));

const OUTCOMES: Record<string, ExtractionOutcome> = {
  book: { ok: true, pageCount: BOOK.length, pages: BOOK },
  broken: { ok: false, code: "invalid_pdf" },
};

const extract: Extractor = async (filePath, { mode }) => {
  const scenario = (await readFile(filePath, "latin1")).replace("%PDF-1.7 ", "").trim();
  const outcome = OUTCOMES[scenario] ?? { ok: false, code: "invalid_pdf" };
  return outcome.ok && mode === "validate" ? { ...outcome, pages: [] } : outcome;
};

const files: FileStore = {
  url: (key) => `${FILES}${key}`,
  find: async () => null,
  upload: async () => {
    throw new Error("not used");
  },
  delete: async () => true,
  list: async () => [],
};

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function deps(db: Database): WorkerADeps {
  return {
    db,
    jina: createJina({
      apiKey: "test",
      embeddingModel: "test-embeddings",
      embeddingDimension: DIMENSION,
      rerankerModel: "test-reranker",
    }),
    extract,
    files,
    browserless: { wsEndpoint: "ws://browserless.test", token: "test" },
    embedding: { model: "test-embeddings", dimension: DIMENSION },
    fileAcl: "public",
    concurrency: { ingestion: 1, imports: 2, control: 2 },
    outboxCron: "* * * * *",
    orphanFileSweep: false,
    ownHosts: [],
    logger,
  };
}

/** An uploaded document version and its queued ingestion job, as upload completion leaves them. */
async function uploadVersion(db: Database, ownerId: string, scenario: string, documentId?: string) {
  const fileKey = `key-${randomUUID()}`;
  stored.set(fileKey, `%PDF-1.7 ${scenario}`);
  const [asset] = await db
    .insert(assets)
    .values({
      ownerId,
      fileKey,
      customId: randomUUID(),
      fileRoute: "sourcePdf",
      acl: "public",
      purpose: "source",
      bytes: 1000,
      mimeType: "application/pdf",
      state: "ready",
    })
    .returning();
  let docId = documentId;
  if (!docId) {
    const [document] = await db
      .insert(documents)
      .values({ ownerId, title: `Doc ${scenario}`, sourceKind: "upload" })
      .returning();
    docId = document!.id;
    await db.insert(libraryItems).values({ userId: ownerId, documentId: docId });
  }
  const [{ next } = { next: 1 }] = await db
    .select({ next: sql<number>`coalesce(max(${documentVersions.versionNo}), 0)::int + 1` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, docId));
  const [version] = await db
    .insert(documentVersions)
    .values({
      documentId: docId,
      versionNo: Number(next),
      assetId: asset!.id,
      status: "queued",
      indexVersion: INDEX_VERSION,
      embeddingModel: "test-embeddings",
      embeddingDimension: DIMENSION,
    })
    .returning();
  if (!documentId) {
    await db
      .update(documents)
      .set({ currentVersionId: version!.id })
      .where(eq(documents.id, docId));
  }
  const operationKey = ingestOperationKey(version!.id);
  const [job] = await db
    .insert(jobs)
    .values({ ownerId, kind: "ingest-document", targetId: version!.id, operationKey })
    .returning();
  return {
    documentId: docId,
    versionId: version!.id,
    jobId: job!.id,
    event: {
      name: "document/version.uploaded" as const,
      id: operationKey,
      data: { documentId: docId, versionId: version!.id, ownerId, jobId: job!.id, operationKey },
    },
  };
}

async function counts(db: Database, versionId: string) {
  const [chunks] = await db
    .select({ total: count(), embedded: count(documentChunks.embedding) })
    .from(documentChunks)
    .where(eq(documentChunks.documentVersionId, versionId));
  const [pages] = await db
    .select({ total: count() })
    .from(documentPages)
    .where(eq(documentPages.documentVersionId, versionId));
  return { chunks: chunks!.total, embedded: chunks!.embedded, pages: pages!.total };
}

const state = async (db: Database, versionId: string) => {
  const [row] = await db
    .select({
      status: documentVersions.status,
      current: documents.currentVersionId,
      sha256: documentVersions.sha256,
      pageCount: documentVersions.pageCount,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentVersions.id, versionId));
  return row!;
};

const jobOf = async (db: Database, jobId: string) =>
  (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;

function engine(db: Database) {
  const inngest = new Inngest({
    id: "foliomind-ingestion-test",
    isDev: false,
    eventKey: "test",
    baseUrl: "https://inngest.test",
  });
  return new InngestTestEngine({ function: createIngestDocumentFunction(inngest, deps(db)) });
}

describeWithDatabase("ingest-document", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  beforeEach(() => {
    jinaCalls = 0;
    failJinaCall = null;
  });

  it("indexes a PDF: pages, chunks, embeddings, full text, activation and a notice", async () => {
    const db = testDb();
    const user = await createUser(db);
    const upload = await uploadVersion(db, user.id, "book");

    const { result, ctx } = await engine(db).execute({ events: [upload.event] });
    expect(result).toEqual({ versionId: upload.versionId, pages: 40, chunks: 40 });

    const indexed = await counts(db, upload.versionId);
    expect(indexed).toEqual({ chunks: 40, embedded: 40, pages: 40 });
    expect(jinaCalls).toBe(Math.ceil(40 / EMBED_BATCH_SIZE));
    const [searchable] = await db
      .select({ total: count() })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.documentVersionId, upload.versionId),
          sql`${documentChunks.searchVector} @@ plainto_tsquery('english', 'willow sediment')`,
        ),
      );
    expect(searchable!.total).toBeGreaterThan(0);

    const version = await state(db, upload.versionId);
    expect(version).toMatchObject({ status: "ready", current: upload.versionId, pageCount: 40 });
    expect(version.sha256).toMatch(/^[0-9a-f]{64}$/);
    const job = await jobOf(db, upload.jobId);
    expect(job).toMatchObject({ status: "succeeded", phase: "done", safeErrorCode: null });
    expect(ctx.step.sendEvent).toHaveBeenCalledWith(
      "notify",
      expect.objectContaining({
        id: `notify:document_ready:${upload.versionId}`,
        data: expect.objectContaining({ type: "document_ready", subjectId: upload.documentId }),
      }),
    );
    const [run] = await db
      .select({ tokens: sql<number>`sum(input_tokens)::int` })
      .from(sql`ai_runs`)
      .where(sql`job_id = ${upload.jobId}`);
    expect(Number(run!.tokens)).toBeGreaterThan(0);
  });

  it("does nothing on a duplicate delivery of the same event", async () => {
    const db = testDb();
    const user = await createUser(db);
    const upload = await uploadVersion(db, user.id, "book");
    await engine(db).execute({ events: [upload.event] });
    const calls = jinaCalls;

    const again = await engine(db).execute({ events: [upload.event] });
    expect(again.result).toBeUndefined();
    expect(jinaCalls).toBe(calls);
    expect(await counts(db, upload.versionId)).toEqual({ chunks: 40, embedded: 40, pages: 40 });
    expect((await jobOf(db, upload.jobId)).status).toBe("succeeded");
  });

  it("reuses the owner's existing index for an identical file without new embeddings", async () => {
    const db = testDb();
    const user = await createUser(db);
    const first = await uploadVersion(db, user.id, "book");
    await engine(db).execute({ events: [first.event] });
    const calls = jinaCalls;

    const copy = await uploadVersion(db, user.id, "book");
    const { result } = await engine(db).execute({ events: [copy.event] });
    expect(result).toEqual({ versionId: copy.versionId, pages: 40, chunks: 40 });
    expect(jinaCalls).toBe(calls);
    expect((await state(db, copy.versionId)).status).toBe("ready");

    // Another user's identical file is never reused (or revealed).
    const stranger = await createUser(db);
    const theirs = await uploadVersion(db, stranger.id, "book");
    await engine(db).execute({ events: [theirs.event] });
    expect(jinaCalls).toBe(calls + Math.ceil(40 / EMBED_BATCH_SIZE));
  });

  it("leaves the previous ready version active when a replacement fails", async () => {
    const db = testDb();
    const user = await createUser(db);
    const first = await uploadVersion(db, user.id, "book");
    await engine(db).execute({ events: [first.event] });

    const replacement = await uploadVersion(db, user.id, "broken", first.documentId);
    const failed = await engine(db).execute({ events: [replacement.event] });
    expect(failed.result).toBeUndefined();

    expect((await state(db, first.versionId)).status).toBe("ready");
    expect((await state(db, replacement.versionId)).current).toBe(first.versionId);
    expect((await state(db, replacement.versionId)).status).not.toBe("ready");
    expect(await counts(db, first.versionId)).toEqual({ chunks: 40, embedded: 40, pages: 40 });
  });

  it("resumes after a restart without re-embedding finished batches", async () => {
    const db = testDb();
    const user = await createUser(db);
    const upload = await uploadVersion(db, user.id, "book");
    // Jina is unavailable on the second batch: the run stops there.
    failJinaCall = 2;
    const firstRun = await engine(db).execute({ events: [upload.event] });
    expect(firstRun.result).toBeUndefined();
    expect(await counts(db, upload.versionId)).toMatchObject({
      chunks: 40,
      embedded: EMBED_BATCH_SIZE,
    });

    // Inngest replays finished steps from their saved outputs; only the failed batch runs again.
    const { sha256 } = await state(db, upload.versionId);
    const saved: Record<string, unknown> = {
      validate: { sha256, pageCount: 40 },
      dedupe: null,
      "extract-pages": { pages: 40 },
      chunk: { pages: 40, chunks: 40 },
      "embed-batch-1": { embedded: EMBED_BATCH_SIZE },
    };
    const steps = Object.entries(saved).map(([id, output]) => ({ id, handler: () => output }));
    failJinaCall = null;
    const before = jinaCalls;
    const resumed = await engine(db).execute({ events: [upload.event], steps });
    expect(resumed.result).toEqual({ versionId: upload.versionId, pages: 40, chunks: 40 });
    expect(jinaCalls - before).toBe(1);
    expect(await counts(db, upload.versionId)).toEqual({ chunks: 40, embedded: 40, pages: 40 });
  });

  it("never resurrects a document deleted while it was processing", async () => {
    const db = testDb();
    const user = await createUser(db);
    const upload = await uploadVersion(db, user.id, "book");
    await db
      .update(documents)
      .set({ status: "deleting", deletedAt: new Date() })
      .where(eq(documents.id, upload.documentId));

    const run = await engine(db).execute({ events: [upload.event] });
    expect(run.result).toBeUndefined();
    expect((await state(db, upload.versionId)).status).not.toBe("ready");
    expect(jinaCalls).toBe(0);
    const [ready] = await db
      .select({ total: count() })
      .from(documentVersions)
      .where(and(eq(documentVersions.id, upload.versionId), isNotNull(documentVersions.sha256)));
    expect(ready!.total).toBe(0);
  });
});
