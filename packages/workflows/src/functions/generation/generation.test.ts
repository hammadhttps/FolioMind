import { randomUUID } from "node:crypto";
import { createGemini, createJina } from "@foliomind/ai";
import {
  collectCitations,
  docSectionIds,
  readProjectDoc,
  type OutlineSection,
} from "@foliomind/contracts";
import {
  aiRuns,
  documentChunks,
  exports as projectExports,
  jobs,
  notifications,
  projectRevisions,
  projects,
  type Database,
} from "@foliomind/db";
import {
  cacheKeys,
  createProject,
  deleteDocument,
  failProjectJob,
  getOwnedProject,
  projectAllowance,
  requestProjectExport,
  requestProjectGeneration,
  requestProjectJobCancel,
  saveProjectContent,
  saveProjectOutline,
  saveProjectRevision,
  saveStudioSettings,
} from "@foliomind/domain";
import {
  createDocument,
  createUser,
  describeWithDatabase,
  testDb,
} from "@foliomind/domain/test/db";
import { InngestTestEngine } from "@inngest/test";
import { and, eq, sql } from "drizzle-orm";
import { Inngest } from "inngest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStore, StoredFile } from "../ingestion/shared";
import { createGenerateDraftFunction } from "./generate-draft";
import { createGenerateOutlineFunction } from "./generate-outline";
import { createRegenerateSectionFunction } from "./regenerate-section";
import { createRenderExportFunction } from "./render-export";
import { heavyConcurrency, type WorkerBDeps } from "./shared";

/*
 * Worker B against Postgres (Phase 8 skill): Gemini and Jina are served by MSW,
 * and Browserless is replaced by a stub (the real render has its own tests in
 * @foliomind/pdf). Checks each function's result, its charge, and what happens
 * on failure, retry, cancel and revoked access.
 */

const renderHtmlToPdf = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => new TextEncoder().encode("%PDF-1.7 export")),
);
vi.mock("@foliomind/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@foliomind/pdf")>()),
  renderHtmlToPdf,
}));

const OUTLINE_REPLY = {
  sections: [
    { heading: "Why cities run hot", notes: "Causes." },
    { heading: "What cools a street", notes: "Measures." },
    { heading: "Where to start", notes: "Priorities." },
  ],
};
const SECTION_REPLY = {
  blocks: [{ type: "paragraph", text: "Trees cool streets by two degrees [S1]." }],
};

interface GeminiCall {
  model: string;
  body: string;
}
let geminiCalls: GeminiCall[] = [];
let reply: (call: GeminiCall) => unknown = () => SECTION_REPLY;
let geminiStatus: (call: GeminiCall) => { status: number; message: string } | null = () => null;

const server = setupServer(
  http.post("https://inngest.test/e/:key", async ({ request }) => {
    const events = (await request.json()) as unknown[];
    return HttpResponse.json({ ids: events.map(() => randomUUID()), status: 200 });
  }),
  http.post(
    "https://generativelanguage.googleapis.com/v1beta/models/:model",
    async ({ request, params }) => {
      const model = String(params.model).split(":")[0]!;
      const call = { model, body: await request.text() };
      geminiCalls.push(call);
      const failure = geminiStatus(call);
      if (failure) {
        return HttpResponse.json(
          { error: { code: failure.status, message: failure.message } },
          { status: failure.status },
        );
      }
      return HttpResponse.json({
        candidates: [
          { content: { role: "model", parts: [{ text: JSON.stringify(reply(call)) }] } },
        ],
        modelVersion: model,
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, totalTokenCount: 300 },
      });
    },
  ),
  http.post("https://api.jina.ai/v1/embeddings", async ({ request }) => {
    const body = (await request.json()) as { input: string[] };
    return HttpResponse.json({
      model: "m",
      data: body.input.map((_, index) => ({
        index,
        embedding: Array.from({ length: 1024 }, () => 0.01),
      })),
      usage: { total_tokens: 10 },
    });
  }),
  http.post("https://api.jina.ai/v1/rerank", async ({ request }) => {
    const body = (await request.json()) as { documents: unknown[] };
    return HttpResponse.json({
      model: "r",
      results: body.documents.map((_, index) => ({ index, relevance_score: 0.5 - index * 0.01 })),
      usage: { total_tokens: 10 },
    });
  }),
);

const uploads = new Map<string, StoredFile>();
const deleted: string[] = [];
const files: FileStore = {
  url: (key) => `https://files.test/f/${key}`,
  find: async (customId) => uploads.get(customId) ?? null,
  upload: async ({ customId, data }) => {
    const file = { key: `key-${randomUUID()}`, size: data.byteLength };
    uploads.set(customId, file);
    return file;
  },
  delete: async (keys) => {
    deleted.push(...keys);
    return true;
  },
  list: async () => [],
};

function deps(db: Database, overrides: Partial<WorkerBDeps> = {}): WorkerBDeps {
  return {
    db,
    gemini: createGemini({ apiKey: "test" }),
    jina: createJina({
      apiKey: "test",
      embeddingModel: "m",
      embeddingDimension: 1024,
      rerankerModel: "r",
    }),
    redis: null,
    cacheKeys: cacheKeys("test"),
    models: { generation: "main-model", fast: "fast-model" },
    embedding: { model: "m", dimension: 1024 },
    browserless: { wsEndpoint: "ws://browserless.test", token: "test" },
    files,
    fileAcl: "public",
    extract: async () => ({ ok: true, pageCount: 4, pages: [] }),
    heavyConcurrency: 1,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

const client = () =>
  new Inngest({
    id: "worker-b-test",
    isDev: false,
    eventKey: "test",
    baseUrl: "https://inngest.test",
  });

const S1 = "33333333-3333-4333-8333-333333333331";
const S2 = "33333333-3333-4333-8333-333333333332";
const S3 = "33333333-3333-4333-8333-333333333333";
const OUTLINE: OutlineSection[] = [
  { id: S1, heading: "One", notes: "First." },
  { id: S2, heading: "Two", notes: "Second." },
  { id: S3, heading: "Three", notes: "Third." },
];

describeWithDatabase("Worker B", () => {
  let db: Database;

  beforeAll(() => {
    server.listen({ onUnhandledFrame: "error" });
    db = testDb();
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  beforeEach(() => {
    geminiCalls = [];
    geminiStatus = () => null;
    reply = (call) => (call.body.includes("Plan a document") ? OUTLINE_REPLY : SECTION_REPLY);
    renderHtmlToPdf.mockClear();
    renderHtmlToPdf.mockImplementation(async () => new TextEncoder().encode("%PDF-1.7 export"));
    uploads.clear();
    deleted.length = 0;
  });

  /** A research project with one ready source and searchable text. */
  async function researchProject(outline: OutlineSection[] = []) {
    const user = await createUser(db);
    const actor = { id: user.id, status: "active" as const };
    const source = await createDocument(db, user.id);
    await db.insert(documentChunks).values(
      [3, 7].map((page, index) => ({
        documentVersionId: source.version.id,
        chunkIndex: index,
        pageStart: page,
        pageEnd: page,
        text: `Trees cool streets by two degrees, page ${page}.`,
        tokenCount: 10,
        contentHash: randomUUID(),
        embedding: Array.from({ length: 1024 }, () => 0.01),
      })),
    );
    const created = await createProject(db, actor, {
      title: "Harbor report",
      mode: "research",
      versionIds: [source.version.id],
    });
    if (!created.ok) throw new Error(created.code);
    await saveStudioSettings(db, actor, {
      projectId: created.projectId,
      prompt: "A report on urban heat for students.",
      mode: "research",
      audience: "Students",
      length: "short",
      template: "academic-report",
      pageSize: "A4",
      cover: false,
      contents: false,
    });
    if (outline.length > 0) {
      await saveProjectOutline(db, actor, { projectId: created.projectId, outline });
    }
    return { actor, projectId: created.projectId, source };
  }

  async function generalProject() {
    const user = await createUser(db);
    const actor = { id: user.id, status: "active" as const };
    const created = await createProject(db, actor, {
      title: "Essay",
      mode: "general",
      versionIds: [],
    });
    if (!created.ok) throw new Error(created.code);
    await saveStudioSettings(db, actor, {
      projectId: created.projectId,
      prompt: "An essay on why bridges sing in the wind.",
      mode: "general",
      audience: "",
      length: "short",
      template: "study-notes",
      pageSize: "A4",
      cover: false,
      contents: false,
    });
    return { actor, projectId: created.projectId };
  }

  async function runOutline(
    context: { actor: { id: string; status: "active" }; projectId: string },
    options: Partial<WorkerBDeps> = {},
  ) {
    const started = await requestProjectGeneration(db, context.actor, context.projectId, {
      kind: "outline",
    });
    if (!started.ok) throw new Error(started.code);
    const [event] = await pendingEvent(started.eventKey);
    const engine = new InngestTestEngine({
      function: createGenerateOutlineFunction(client(), deps(db, options)),
    });
    return { ...(await engine.execute({ events: [event as never] })), started };
  }

  async function pendingEvent(eventKey: string) {
    const rows = await db.execute<{ topic: string; payload: Record<string, unknown> }>(
      sql`select topic, payload from outbox_events where event_key = ${eventKey}`,
    );
    return rows.map((row) => ({ name: row.topic, id: eventKey, data: row.payload }));
  }

  async function runDraft(
    context: { actor: { id: string; status: "active" }; projectId: string },
    { replace = false, ...options }: Partial<WorkerBDeps> & { replace?: boolean } = {},
  ) {
    const started = await requestProjectGeneration(db, context.actor, context.projectId, {
      kind: "draft",
      replace,
    });
    if (!started.ok) throw new Error(started.code);
    const [event] = await pendingEvent(started.eventKey);
    const engine = new InngestTestEngine({
      function: createGenerateDraftFunction(client(), deps(db, options)),
    });
    return { ...(await engine.execute({ events: [event as never] })), started };
  }

  const project = (context: { actor: { id: string; status: "active" }; projectId: string }) =>
    getOwnedProject(db, context.actor, context.projectId);

  async function chargedOutline(context: {
    actor: { id: string; status: "active" };
    projectId: string;
  }) {
    await runOutline(context);
    const current = await project(context);
    if (current?.outline.length !== 3) throw new Error("no outline");
    return current;
  }

  describe("flow control", () => {
    it("all four functions share one heavy concurrency key", () => {
      const inngest = client();
      const dependencies = deps(testDb(), { heavyConcurrency: 1 });
      const functions = [
        createGenerateOutlineFunction(inngest, dependencies),
        createGenerateDraftFunction(inngest, dependencies),
        createRegenerateSectionFunction(inngest, dependencies),
        createRenderExportFunction(inngest, dependencies),
      ];
      for (const fn of functions) {
        const options = (fn as unknown as { opts: { concurrency: unknown; retries: number } }).opts;
        expect(options.concurrency).toEqual([heavyConcurrency(1)]);
        expect(options.retries).toBe(3);
      }
      expect(heavyConcurrency(1)).toEqual({ limit: 1, key: '"worker-b-heavy"', scope: "env" });
    });
  });

  describe("generate-outline", () => {
    it("saves an editable outline from retrieved evidence, and takes the credit", async () => {
      const context = await researchProject();
      const { result, started } = await runOutline(context);
      expect(result).toEqual({ sections: 3 });

      const current = await project(context);
      expect(current?.outline.map((section) => section.heading)).toEqual([
        "Why cities run hot",
        "What cools a street",
        "Where to start",
      ]);
      expect(current?.status).toBe("outline");
      expect(current?.creditOperationKey).toMatch(/^project-credit:/);
      // Nothing is drafted until the owner approves.
      expect(docSectionIds(current!.content)).toEqual([]);

      expect(geminiCalls).toHaveLength(1);
      expect(geminiCalls[0]?.model).toBe("main-model");
      expect(geminiCalls[0]?.body).toContain("Trees cool streets");

      const [job] = await db.select().from(jobs).where(eq(jobs.id, started.jobId));
      expect(job?.status).toBe("succeeded");
      expect((await projectAllowance(db, context.actor.id)).projects.used).toBe(1);
      const [run] = await db.select().from(aiRuns).where(eq(aiRuns.jobId, started.jobId));
      expect(run).toMatchObject({ purpose: "project-outline", model: "main-model" });
      // Counts only: no prompt or document text in the run's metadata.
      expect(JSON.stringify(run?.retrievalMetadata)).not.toContain("Trees");
    });

    it("general mode uses no sources and asks nothing of Jina", async () => {
      const context = await generalProject();
      const { result } = await runOutline(context, { jina: null });
      expect(result).toEqual({ sections: 3 });
      expect(geminiCalls[0]?.body).toContain("general knowledge");
      expect(geminiCalls[0]?.body).not.toContain("<passage-");
    });

    it("a source removed before it runs stops it, and returns the credit", async () => {
      const context = await researchProject();
      const started = await requestProjectGeneration(db, context.actor, context.projectId, {
        kind: "outline",
      });
      if (!started.ok) throw new Error(started.code);
      await deleteDocument(db, context.actor, context.source.document.id);
      const [event] = await pendingEvent(started.eventKey);
      const run = await new InngestTestEngine({
        function: createGenerateOutlineFunction(client(), deps(db)),
      }).execute({ events: [event as never] });
      expect(String((run as { error?: { message?: string } }).error?.message)).toContain(
        "source_unavailable",
      );
      expect(geminiCalls).toHaveLength(0);
    });
  });

  describe("generate-draft", () => {
    it("writes each section with citations mapped to real chunks, then revision 1", async () => {
      const context = await researchProject();
      await chargedOutline(context);
      geminiCalls = [];
      const { result, started } = await runDraft(context);
      expect(result).toMatchObject({ citations: 3, uncovered: 0 });
      expect(geminiCalls).toHaveLength(3);

      const current = await project(context);
      expect(current?.status).toBe("editing");
      expect(current?.firstDraftAt).not.toBeNull();
      expect(docSectionIds(current!.content)).toEqual(
        current!.outline.map((section) => section.id),
      );

      const citations = collectCitations(current!.content);
      expect(citations).toHaveLength(3);
      for (const citation of citations) {
        expect(citation.versionId).toBe(context.source.version.id);
        expect(citation.chunkId).toEqual(expect.any(String));
        expect(citation.verified).toBe(true);
        expect([3, 7]).toContain(citation.pageStart);
      }
      // Two pages at most, so at most two reference numbers.
      expect(new Set(citations.map((citation) => citation.label)).size).toBeLessThanOrEqual(2);

      const revisions = await db
        .select()
        .from(projectRevisions)
        .where(eq(projectRevisions.projectId, context.projectId));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ revisionNo: 1, createdBy: context.actor.id });
      expect(revisions[0]?.sourceSnapshot).toEqual([
        { versionId: context.source.version.id, title: "Test document" },
      ]);

      const [job] = await db.select().from(jobs).where(eq(jobs.id, started.jobId));
      expect(job).toMatchObject({ status: "succeeded", phase: "done" });
      expect(job?.progress).toMatchObject({ sections: 3, sectionsDone: 3 });
      // Still one credit in all: it covers the outline and this draft.
      const allowance = await projectAllowance(db, context.actor.id);
      expect(allowance.projects.used).toBe(1);
      expect(allowance.regenerations.used).toBe(0);
      const sectionRuns = await db
        .select()
        .from(aiRuns)
        .where(and(eq(aiRuns.jobId, started.jobId), eq(aiRuns.purpose, "project-section")));
      expect(sectionRuns).toHaveLength(3);
      expect(Number(sectionRuns[0]?.estimatedCost)).toBeGreaterThan(0);
    });

    it("sends each section only its own evidence, in delimiters", async () => {
      const context = await researchProject(OUTLINE);
      await db
        .update(projects)
        .set({ creditOperationKey: "paid" })
        .where(eq(projects.id, context.projectId));
      await runDraft(context);
      const body = geminiCalls[0]?.body ?? "";
      expect(body).toMatch(/<passage-[0-9a-f]{12} label=\\"S1\\"/);
      expect(body).toContain("Heading: One");
      expect(geminiCalls[1]?.body).toContain("Heading: Two");
    });

    it("drops labels the model made up", async () => {
      const context = await researchProject(OUTLINE);
      await db
        .update(projects)
        .set({ creditOperationKey: "paid" })
        .where(eq(projects.id, context.projectId));
      reply = () => ({
        blocks: [{ type: "paragraph", text: "Real [S1] and invented [S99] claims." }],
      });
      await runDraft(context);
      const current = await project(context);
      expect(JSON.stringify(current?.content)).not.toContain("S99");
      expect(collectCitations(current!.content)).toHaveLength(3);
    });

    it("general mode never cites, whatever the model writes", async () => {
      const context = await generalProject();
      await chargedOutline(context);
      reply = () => ({ blocks: [{ type: "paragraph", text: "Bridges sing [S1] in the wind." }] });
      const { result } = await runDraft(context, { jina: null });
      expect(result).toMatchObject({ citations: 0 });
      const current = await project(context);
      expect(collectCitations(current!.content)).toEqual([]);
      expect(JSON.stringify(current?.content)).toContain("Bridges sing");
      expect(JSON.stringify(current?.content)).not.toContain("S1");
    });

    it("a section with no citation in research mode says it isn't covered", async () => {
      const context = await researchProject(OUTLINE);
      await db
        .update(projects)
        .set({ creditOperationKey: "paid" })
        .where(eq(projects.id, context.projectId));
      reply = () => ({ blocks: [{ type: "paragraph", text: "Uncited claim." }] });
      const { result } = await runDraft(context);
      expect(result).toMatchObject({ citations: 0, uncovered: 3, requests: 6 });
      const current = await project(context);
      expect(JSON.stringify(current?.content)).toContain("don't appear to cover");
      expect(JSON.stringify(current?.content)).not.toContain("Uncited claim");
    });

    it("keeps going on the second model when the first has no quota left", async () => {
      const context = await researchProject(OUTLINE);
      await db
        .update(projects)
        .set({ creditOperationKey: "paid" })
        .where(eq(projects.id, context.projectId));
      geminiStatus = (call) =>
        call.model === "main-model"
          ? { status: 429, message: 'quota "retryDelay": "6000s"' }
          : null;
      const { result } = await runDraft(context);
      expect(result).toMatchObject({ citations: 3 });
      expect(geminiCalls.filter((call) => call.model === "fast-model")).toHaveLength(3);
    });

    it("stops with a clear reason when both models are out for the day", async () => {
      const context = await researchProject(OUTLINE);
      await db
        .update(projects)
        .set({ creditOperationKey: "paid" })
        .where(eq(projects.id, context.projectId));
      geminiStatus = () => ({ status: 429, message: 'quota "retryDelay": "6000s"' });
      const run = await runDraft(context);
      expect(String((run as { error?: { message?: string } }).error?.message)).toContain(
        "provider_daily_limit",
      );
    });

    it("picks up where it left off, without writing finished sections again", async () => {
      const context = await researchProject();
      await chargedOutline(context);
      const current = (await project(context))!;
      const [first, second] = current.outline;
      const firstAttempt = await runDraft(context, {
        // The second section's Gemini call fails for good on the first attempt.
        gemini: {
          ...createGemini({ apiKey: "test" }),
          generateStructured: vi.fn(async (schema, options) => {
            const gemini = createGemini({ apiKey: "test" });
            if (String(options.prompt).includes(`Heading: ${second!.heading}`)) {
              throw Object.assign(new Error("refused"), { name: "ProviderError" });
            }
            return gemini.generateStructured(schema, options);
          }),
        } as never,
      });
      expect((firstAttempt as { error?: unknown }).error).toBeDefined();
      const partial = (await project(context))!;
      expect(docSectionIds(partial.content)).toEqual([first!.id]);
      await failProjectJob(db, {
        jobId: firstAttempt.started.jobId,
        projectId: context.projectId,
        usageKey: null,
        code: "generation_failed",
        markProject: true,
      });

      geminiCalls = [];
      const { result } = await runDraft(context);
      expect(result).toMatchObject({ citations: 2 });
      expect(geminiCalls).toHaveLength(2);
      const finished = (await project(context))!;
      expect(docSectionIds(finished.content)).toEqual(current.outline.map((section) => section.id));
      const allowance = await projectAllowance(db, context.actor.id);
      expect(allowance.projects.used).toBe(1);
    });

    it("a redraft replaces every section and spends a regeneration", async () => {
      const context = await researchProject();
      await chargedOutline(context);
      await runDraft(context);
      geminiCalls = [];
      reply = () => ({ blocks: [{ type: "paragraph", text: "Second draft [S1]." }] });
      const { result } = await runDraft(context, { replace: true });
      expect(result).toMatchObject({ citations: 3 });
      expect(geminiCalls).toHaveLength(3);
      const current = (await project(context))!;
      expect(JSON.stringify(current.content)).toContain("Second draft");
      expect(JSON.stringify(current.content)).not.toContain("Trees cool streets");
      expect((await projectAllowance(db, context.actor.id)).regenerations.used).toBe(1);
    });

    it("retries rather than calling a section uncovered when search is down", async () => {
      const context = await researchProject(OUTLINE);
      await db
        .update(projects)
        .set({ creditOperationKey: "paid" })
        .where(eq(projects.id, context.projectId));
      server.use(
        http.post(
          "https://api.jina.ai/v1/embeddings",
          () => new HttpResponse("down", { status: 503 }),
        ),
      );
      const run = await runDraft(context);
      expect((run as { error?: unknown }).error).toBeDefined();
      expect(geminiCalls).toHaveLength(0);
      expect(docSectionIds((await project(context))!.content)).toEqual([]);
    });

    it("a cancelled job writes nothing more", async () => {
      const context = await researchProject();
      await chargedOutline(context);
      const started = await requestProjectGeneration(db, context.actor, context.projectId, {
        kind: "draft",
        replace: false,
      });
      if (!started.ok) throw new Error(started.code);
      await requestProjectJobCancel(db, context.actor.id, started.jobId);
      geminiCalls = [];
      const [event] = await pendingEvent(started.eventKey);
      const run = await new InngestTestEngine({
        function: createGenerateDraftFunction(client(), deps(db)),
      }).execute({ events: [event as never] });
      expect(String((run as { error?: { message?: string } }).error?.message)).toContain(
        "cancelled",
      );
      expect(geminiCalls).toHaveLength(0);
      expect(docSectionIds((await project(context))!.content)).toEqual([]);
    });
  });

  describe("regenerate-section", () => {
    it("saves a proposal, leaving the document and its counter untouched", async () => {
      const context = await researchProject();
      await chargedOutline(context);
      await runDraft(context);
      const before = (await project(context))!;
      const sectionId = before.outline[1]!.id;

      // The owner renamed this section in the editor; the proposal keeps their heading.
      const edited = {
        type: "doc" as const,
        content: before.content.content.map((node) =>
          node.type === "heading" && node.attrs.sectionId === sectionId
            ? { ...node, content: [{ type: "text" as const, text: "My own heading" }] }
            : node,
        ),
      };
      const saved = await saveProjectContent(db, context.actor, {
        projectId: context.projectId,
        baseCounter: before.revisionCounter,
        content: edited,
      });
      if (!saved.ok) throw new Error(saved.code);
      const held = (await project(context))!;

      const started = await requestProjectGeneration(db, context.actor, context.projectId, {
        kind: "section",
        sectionId,
      });
      if (!started.ok) throw new Error(started.code);
      reply = () => ({ blocks: [{ type: "paragraph", text: "A rewritten section [S1]." }] });
      const [event] = await pendingEvent(started.eventKey);
      const { result } = await new InngestTestEngine({
        function: createRegenerateSectionFunction(client(), deps(db)),
      }).execute({ events: [event as never] });
      expect(result).toEqual({ citations: 1 });

      const after = (await project(context))!;
      expect(after.content).toEqual(held.content);
      expect(after.revisionCounter).toBe(held.revisionCounter);
      expect(after.status).toBe("editing");
      expect(after.proposals).toHaveLength(1);
      expect(JSON.stringify(after.proposals[0]?.nodes)).toContain("A rewritten section");
      expect(JSON.stringify(after.proposals[0]?.nodes)).toContain("My own heading");
      expect((await projectAllowance(db, context.actor.id)).regenerations.used).toBe(1);
    });
  });

  describe("render-export", () => {
    async function requested() {
      const context = await researchProject();
      await chargedOutline(context);
      await runDraft(context);
      const revision = await saveProjectRevision(db, context.actor, context.projectId);
      if (!revision.ok) throw new Error(revision.code);
      const exported = await requestProjectExport(
        db,
        context.actor,
        context.projectId,
        revision.revision.id,
      );
      if (!exported.ok || exported.reused) throw new Error("export");
      const [event] = await pendingEvent(exported.eventKey);
      return { ...context, exported, event, revision };
    }

    it("renders the exact revision, records checksum and pages, and notifies", async () => {
      const { exported, event, projectId, actor, revision } = await requested();
      const later = (await getOwnedProject(db, actor, projectId))!;
      await saveProjectContent(db, actor, {
        projectId,
        baseCounter: later.revisionCounter,
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Typed after asking." }] },
          ],
        },
      });
      const { result } = await new InngestTestEngine({
        function: createRenderExportFunction(client(), deps(db)),
      }).execute({ events: [event as never] });
      expect(result).toEqual({ pages: 4 });

      expect(renderHtmlToPdf).toHaveBeenCalledTimes(1);
      const [, html, options] = renderHtmlToPdf.mock.calls[0] as [
        unknown,
        string,
        Record<string, unknown>,
      ];
      expect(html).toContain("Trees cool streets");
      expect(html).not.toContain("Typed after asking.");
      expect(html).toContain("References");
      expect(options).toMatchObject({ format: "A4", displayHeaderFooter: true, accessible: true });

      const [row] = await db
        .select()
        .from(projectExports)
        .where(eq(projectExports.id, exported.exportId));
      expect(row).toMatchObject({
        status: "ready",
        pageCount: 4,
        projectRevisionId: revision.revision.id,
        templateVersion: "academic-report@1",
      });
      expect(row?.assetId).not.toBeNull();
      const [job] = await db.select().from(jobs).where(eq(jobs.id, exported.jobId));
      expect(job).toMatchObject({ status: "succeeded" });
      expect(job?.result).toMatchObject({ pageCount: 4, bytes: expect.any(Number) });
      expect(uploads.get(`export:${exported.eventKey}`)).toBeDefined();
    });

    it("a retry uses the file an earlier attempt stored, and stores one", async () => {
      const { exported, event } = await requested();
      uploads.set(`export:${exported.eventKey}`, { key: "already-there", size: 15 });
      server.use(
        http.get("https://files.test/f/already-there", () =>
          HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-1.7 export").buffer),
        ),
      );
      const { result } = await new InngestTestEngine({
        function: createRenderExportFunction(client(), deps(db)),
      }).execute({ events: [event as never] });
      expect(result).toEqual({ pages: 4 });
      expect(renderHtmlToPdf).not.toHaveBeenCalled();
    });

    it("refuses over 200 pages with export_too_large, keeping no file", async () => {
      const { exported, event } = await requested();
      const run = await new InngestTestEngine({
        function: createRenderExportFunction(
          client(),
          deps(db, { extract: async () => ({ ok: false, code: "too_many_pages" }) }),
        ),
      }).execute({ events: [event as never] });
      expect(String((run as { error?: { message?: string } }).error?.message)).toContain(
        "export_too_large",
      );
      expect(uploads.get(`export:${exported.eventKey}`)).toBeUndefined();
    });

    it("fails clearly when the renderer breaks, and when it isn't set up", async () => {
      const first = await requested();
      renderHtmlToPdf.mockRejectedValueOnce(new Error("page crashed"));
      const crashed = await new InngestTestEngine({
        function: createRenderExportFunction(client(), deps(db)),
      }).execute({ events: [first.event as never] });
      expect(String((crashed as { error?: { message?: string } }).error?.message)).toContain(
        "export_failed",
      );

      const second = await requested();
      const missing = await new InngestTestEngine({
        function: createRenderExportFunction(client(), deps(db, { browserless: null })),
      }).execute({ events: [second.event as never] });
      expect(String((missing as { error?: { message?: string } }).error?.message)).toContain(
        "export_failed",
      );
    });

    it("removes the stored file when it would go over the storage limit", async () => {
      const { event, exported } = await requested();
      renderHtmlToPdf.mockImplementation(async () => new Uint8Array(200));
      const big = {
        ...files,
        upload: async () => ({ key: "too-big", size: 200 * 1024 * 1024 }),
      };
      const run = await new InngestTestEngine({
        function: createRenderExportFunction(client(), deps(db, { files: big })),
      }).execute({ events: [event as never] });
      expect(String((run as { error?: { message?: string } }).error?.message)).toContain(
        "storage_limit",
      );
      expect(deleted).toContain("too-big");
      const [row] = await db
        .select({ assetId: projectExports.assetId })
        .from(projectExports)
        .where(eq(projectExports.id, exported.exportId));
      expect(row?.assetId).toBeNull();
    });
  });

  it("notification events carry IDs only", async () => {
    const context = await researchProject();
    await chargedOutline(context);
    const { started } = await runDraft(context);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, context.actor.id));
    // The notice is written by send-notification from the event, not here.
    expect(rows).toEqual([]);
    expect(readProjectDoc((await project(context))?.content)).toBeDefined();
    expect(started.eventKey).toMatch(/^generate-draft:/);
  });
});
