import { randomUUID } from "node:crypto";
import { documentVersions, jobs, outboxEvents, type Database } from "@foliomind/db";
import { ingestOperationKey } from "@foliomind/domain";
import {
  createDocument,
  createUser,
  describeWithDatabase,
  testDb,
} from "@foliomind/domain/test/db";
import { InngestTestEngine } from "@inngest/test";
import { eq } from "drizzle-orm";
import { Inngest } from "inngest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createDispatchOutboxFunction } from "./control";
import type { WorkerADeps } from "./shared";

/*
 * dispatch-outbox against Postgres: it delivers rows the web app couldn't send
 * and re-queues uploads whose event was delivered while no function was
 * registered to receive it (documents uploaded before background functions
 * went live, or during a failed sync).
 */

const sent: { name: string; id?: string; data: { jobId?: string } }[] = [];
const server = setupServer(
  http.post("https://inngest.test/e/:key", async ({ request }) => {
    const events = (await request.json()) as typeof sent;
    sent.push(...events);
    return HttpResponse.json({ ids: events.map(() => randomUUID()), status: 200 });
  }),
);

function engine(db: Database) {
  const inngest = new Inngest({
    id: "control-test",
    isDev: false,
    eventKey: "test",
    baseUrl: "https://inngest.test",
  });
  const deps = {
    db,
    concurrency: { ingestion: 1, imports: 2, control: 2 },
    outboxCron: "0 * * * *",
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as WorkerADeps;
  return new InngestTestEngine({ function: createDispatchOutboxFunction(inngest, deps) });
}

async function queuedJob(db: Database, ageMs: number) {
  const owner = await createUser(db);
  const { version } = await createDocument(db, owner.id);
  await db
    .update(documentVersions)
    .set({ status: "queued" })
    .where(eq(documentVersions.id, version.id));
  const [job] = await db
    .insert(jobs)
    .values({
      ownerId: owner.id,
      kind: "ingest-document",
      targetId: version.id,
      operationKey: ingestOperationKey(version.id),
      createdAt: new Date(Date.now() - ageMs),
    })
    .returning();
  return { job: job!, versionId: version.id };
}

describeWithDatabase("dispatch-outbox", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    server.resetHandlers();
    sent.length = 0;
  });
  afterAll(() => server.close());

  it("re-queues ingestion that never started, and delivers the new event", async () => {
    const db = testDb();
    const stalled = await queuedJob(db, 2 * 60 * 60 * 1000);
    const recent = await queuedJob(db, 60 * 1000);

    await engine(db).execute();

    const [old] = await db.select().from(jobs).where(eq(jobs.id, stalled.job.id));
    expect(old!.status).toBe("cancelled");
    const replacements = await db.select().from(jobs).where(eq(jobs.targetId, stalled.versionId));
    const replacement = replacements.find((row) => row.id !== stalled.job.id);
    expect(replacement?.status).toBe("queued");
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, replacement!.operationKey));
    expect(event!.deliveredAt).not.toBeNull();
    expect(sent.some((item) => item.data.jobId === replacement!.id)).toBe(true);

    // A job that was only just queued is left alone.
    const [young] = await db.select().from(jobs).where(eq(jobs.id, recent.job.id));
    expect(young!.status).toBe("queued");
  });
});
