import { randomUUID } from "node:crypto";
import { createJina } from "@foliomind/ai";
import {
  documents,
  jobs,
  outboxEvents,
  urlImports,
  usageOperations,
  type Database,
} from "@foliomind/db";
import { requestUrlImport } from "@foliomind/domain";
import { createUser, describeWithDatabase, testDb } from "@foliomind/domain/test/db";
import { InngestTestEngine } from "@inngest/test";
import { eq } from "drizzle-orm";
import { Inngest } from "inngest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createImportUrlFunction } from "./import-url";
import type { FileStore, StoredFile, WorkerADeps } from "./shared";

/*
 * import-url against Postgres: Jina Reader is served by MSW and the
 * Browserless render is replaced by a stub (the real render is covered by the
 * e2e import test). Checks the Section 27 validation, the snapshot hand-off to
 * ingestion, usage, and that a retry reuses an already stored snapshot.
 */

vi.mock("@foliomind/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@foliomind/pdf")>()),
  renderHtmlToPdf: vi.fn(async () => new TextEncoder().encode("%PDF-1.7 snapshot")),
}));

let article = "";
let readerCalls = 0;
const server = setupServer(
  http.post("https://inngest.test/e/:key", async ({ request }) => {
    const events = (await request.json()) as unknown[];
    return HttpResponse.json({ ids: events.map(() => randomUUID()), status: 200 });
  }),
  http.post("https://r.jina.ai/", () => {
    readerCalls += 1;
    return HttpResponse.json({
      code: 200,
      data: {
        title: "Rivers and Their Banks",
        url: "https://example.com/a",
        content: article,
        usage: { tokens: 900 },
      },
    });
  }),
);

const uploads = new Map<string, StoredFile>();
const files: FileStore = {
  url: (key) => `https://files.test/f/${key}`,
  find: async (customId) => uploads.get(customId) ?? null,
  upload: async ({ customId, data }) => {
    const file = { key: `key-${randomUUID()}`, size: data.byteLength };
    uploads.set(customId, file);
    return file;
  },
  delete: async () => true,
  list: async () => [],
};

function deps(db: Database): WorkerADeps {
  return {
    db,
    jina: createJina({
      apiKey: "test",
      embeddingModel: "m",
      embeddingDimension: 1024,
      rerankerModel: "r",
    }),
    extract: async () => ({ ok: false, code: "invalid_pdf" }),
    files,
    browserless: { wsEndpoint: "ws://browserless.test", token: "test" },
    embedding: { model: "m", dimension: 1024 },
    fileAcl: "public",
    concurrency: { ingestion: 1, imports: 2, control: 2 },
    outboxCron: "* * * * *",
    orphanFileSweep: false,
    ownHosts: ["folio-mind-two.vercel.app"],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

function engine(db: Database) {
  const inngest = new Inngest({
    id: "import-test",
    isDev: false,
    eventKey: "test",
    baseUrl: "https://inngest.test",
  });
  return new InngestTestEngine({ function: createImportUrlFunction(inngest, deps(db)) });
}

async function requested(db: Database) {
  const user = await createUser(db);
  const result = await requestUrlImport(db, {
    userId: user.id,
    url: new URL(`https://example.com/articles/${randomUUID()}`),
  });
  if (!result.ok) throw new Error(result.code);
  return {
    ...result,
    userId: user.id,
    event: {
      name: "document/url-import.requested" as const,
      id: result.eventKey,
      data: {
        importId: result.importId,
        documentId: result.documentId,
        ownerId: user.id,
        jobId: result.jobId,
        operationKey: result.eventKey,
      },
    },
  };
}

const ARTICLE = Array.from(
  { length: 40 },
  (_, i) =>
    `Paragraph ${i}: rivers move sediment, and willow roots hold the banks through the floods of spring.`,
).join("\n\n");

describeWithDatabase("import-url", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  beforeEach(() => {
    readerCalls = 0;
    article = ARTICLE;
  });

  it("snapshots the article and hands the new version to ingestion", async () => {
    const db = testDb();
    const request = await requested(db);
    const { result } = await engine(db).execute({ events: [request.event] });
    expect(result).toEqual({ versionId: expect.any(String) });

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, request.documentId));
    expect(document).toMatchObject({
      title: "Rivers and Their Banks",
      currentVersionId: (result as { versionId: string }).versionId,
    });
    const [row] = await db.select().from(urlImports).where(eq(urlImports.id, request.importId));
    expect(row).toMatchObject({ status: "ingesting", fetchedTitle: "Rivers and Their Banks" });
    expect(row!.wordCount).toBeGreaterThan(200);
    const [usage] = await db
      .select()
      .from(usageOperations)
      .where(eq(usageOperations.operationKey, request.eventKey));
    expect(usage!.status).toBe("committed");
    const [ingest] = await db
      .select()
      .from(outboxEvents)
      .where(
        eq(outboxEvents.eventKey, `ingest-document:${(result as { versionId: string }).versionId}`),
      );
    expect(ingest!.deliveredAt).not.toBeNull();
    expect(uploads.get(`snapshot:${request.importId}`)).toBeDefined();
  });

  it("fails a page too short to be an article as unsupported, without uploading", async () => {
    const db = testDb();
    const request = await requested(db);
    article = "Please sign in to continue reading.";
    const run = await engine(db).execute({ events: [request.event] });
    expect(run.result).toBeUndefined();
    expect(String((run as { error?: { message?: string } }).error?.message)).toContain(
      "unsupported_page",
    );
    expect(uploads.get(`snapshot:${request.importId}`)).toBeUndefined();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, request.jobId));
    expect(job!.status).toBe("running");
  });

  it("reuses a snapshot an earlier attempt already stored", async () => {
    const db = testDb();
    const request = await requested(db);
    uploads.set(`snapshot:${request.importId}`, { key: `key-${randomUUID()}`, size: 4096 });
    const { result } = await engine(db).execute({ events: [request.event] });
    expect(result).toEqual({ versionId: expect.any(String) });
    expect(readerCalls).toBe(0);
  });
});
