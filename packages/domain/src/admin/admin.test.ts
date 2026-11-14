import { randomUUID } from "node:crypto";
import { aiRuns, documentVersions, jobs, outboxEvents, projects, users } from "@foliomind/db";
import { eq, sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import { globalSearch } from "../search";
import { loadUserSnapshot, signIn } from "../users";
import {
  adminOverviewCounts,
  healthSummary,
  listAdminJobs,
  listAdminUsers,
  listAuditLog,
  retryJobAsAdmin,
  suspendUser,
  unsuspendUser,
  usageReport,
} from "./index";

describeWithDatabase("admin overview", () => {
  let db: ReturnType<typeof testDb>;
  beforeAll(() => {
    db = testDb();
  });

  it("suspends at once, refuses admins and self, and lifts timed suspensions", async () => {
    const admin = await createUser(db, { role: "admin" });
    const otherAdmin = await createUser(db, { role: "admin" });
    const reader = await createUser(db);
    expect(
      await suspendUser(db, admin, { userId: admin.id, reason: "Testing myself here" }),
    ).toEqual({
      ok: false,
      code: "self",
    });
    expect(
      await suspendUser(db, admin, { userId: otherAdmin.id, reason: "Not allowed here" }),
    ).toEqual({
      ok: false,
      code: "admin_target",
    });
    // Relative to today: the snapshot load compares with the real clock.
    const now = new Date();
    const day = (offset: number) =>
      new Date(now.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(
      await suspendUser(
        db,
        admin,
        { userId: reader.id, reason: "Spam reports", endsOn: day(0) },
        now,
      ),
    ).toEqual({ ok: false, code: "end_in_past" });
    expect(
      await suspendUser(
        db,
        admin,
        { userId: reader.id, reason: "Repeated spam reports", endsOn: day(2) },
        now,
      ),
    ).toEqual({ ok: true, userId: reader.id });
    expect((await loadUserSnapshot(db, reader.id))?.status).toBe("suspended");
    expect(
      await suspendUser(db, admin, { userId: reader.id, reason: "Repeated spam reports" }, now),
    ).toEqual({ ok: false, code: "already_suspended" });

    // Once the end date passes, the next snapshot load (or sign-in) lifts it.
    await db
      .update(users)
      .set({ suspendedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, reader.id));
    expect((await loadUserSnapshot(db, reader.id))?.status).toBe("active");
    const audits = await listAuditLog(db, { q: reader.id, limit: 10 });
    expect(audits.items.map((row) => row.action)).toEqual(["user.unsuspended", "user.suspended"]);
    expect(audits.items[0]?.actorId).toBeNull();

    // Without an end date only an admin lifts it; sign-in is refused meanwhile.
    await suspendUser(db, admin, { userId: reader.id, reason: "Repeated spam reports" });
    const refused = await signIn(db, {
      sub: reader.auth0Sub,
      email: reader.email,
      emailVerified: true,
    });
    expect(refused).toMatchObject({ kind: "refused", reason: "suspended" });
    expect(await unsuspendUser(db, admin, { userId: reader.id })).toEqual({
      ok: true,
      userId: reader.id,
    });
    expect(await unsuspendUser(db, admin, { userId: reader.id })).toEqual({
      ok: false,
      code: "not_suspended",
    });
  });

  it("lists users with filters and keyset pages", async () => {
    const tag = `admin-list-${randomUUID().slice(0, 8)}`;
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(
        await createUser(db, {
          displayName: `${tag} ${index}`,
          role: index === 0 ? "publisher" : "reader",
        }),
      );
    }
    const first = await listAdminUsers(db, { q: tag, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAdminUsers(db, { q: tag, after: first.nextCursor!, limit: 2 });
    const third = await listAdminUsers(db, { q: tag, after: second.nextCursor!, limit: 2 });
    const ids = [...first.items, ...second.items, ...third.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
    const back = await listAdminUsers(db, { q: tag, before: second.prevCursor!, limit: 2 });
    expect(back.items.map((row) => row.id)).toEqual(first.items.map((row) => row.id));
    const publishers = await listAdminUsers(db, { q: tag, role: "publisher", limit: 25 });
    expect(publishers.items.map((row) => row.id)).toEqual([created[0]!.id]);
    expect((await listAdminUsers(db, { q: tag, plan: "pro", limit: 25 })).items).toEqual([]);
  });

  it("retries a failed ingestion once with a new key, and refuses permanent failures", async () => {
    const admin = await createUser(db, { role: "admin" });
    const owner = await createUser(db);
    const { document, version } = await createDocument(db, owner.id);
    await db
      .update(documentVersions)
      .set({ status: "failed" })
      .where(eq(documentVersions.id, version.id));
    const [failed] = await db
      .insert(jobs)
      .values({
        ownerId: owner.id,
        kind: "ingest-document",
        targetId: version.id,
        operationKey: `ingest-document:${version.id}`,
        status: "failed",
        safeErrorCode: "provider_unavailable",
      })
      .returning();
    const retried = await retryJobAsAdmin(db, admin, failed!.id);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    const [newJob] = await db.select().from(jobs).where(eq(jobs.id, retried.jobId));
    expect(newJob?.operationKey).toBe(`ingest-document:${version.id}:retry-1`);
    expect(
      await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, retried.eventKeys[0]!)),
    ).toHaveLength(1);
    // The old job is no longer the latest, so a second retry is refused.
    expect(await retryJobAsAdmin(db, admin, failed!.id)).toEqual({
      ok: false,
      code: "not_retryable",
    });

    const [permanent] = await db
      .insert(jobs)
      .values({
        ownerId: owner.id,
        kind: "ingest-document",
        targetId: version.id,
        operationKey: `ingest-document:${version.id}:x`,
        status: "failed",
        safeErrorCode: "invalid_pdf",
      })
      .returning();
    expect(await retryJobAsAdmin(db, admin, permanent!.id)).toEqual({
      ok: false,
      code: "not_retryable",
    });
    const listed = await listAdminJobs(db, { q: owner.email, limit: 25 });
    expect(listed.items.map((row) => row.id)).toEqual(
      expect.arrayContaining([failed!.id, permanent!.id, retried.jobId]),
    );
    expect(listed.items.find((row) => row.id === permanent!.id)?.canRetry).toBe(false);
    const audit = await listAuditLog(db, { action: "job.retried", q: failed!.id, limit: 5 });
    expect(audit.items).toHaveLength(1);
    expect(document.id).toBeTruthy();
  });

  it("reports health, usage by day and purpose, and overview counts", async () => {
    const user = await createUser(db);
    await db.insert(aiRuns).values([
      {
        userId: user.id,
        purpose: "chat-answer",
        provider: "gemini",
        model: "m",
        inputTokens: 100,
        outputTokens: 20,
        estimatedCost: "0.001",
        latencyMs: 10,
        status: "succeeded",
      },
      {
        userId: user.id,
        purpose: "chat-answer",
        provider: "gemini",
        model: "m",
        inputTokens: 50,
        outputTokens: 0,
        latencyMs: 10,
        status: "failed",
      },
    ]);
    const report = await usageReport(db, { rangeDays: 7 });
    const today = new Date().toISOString().slice(0, 10);
    const day = report.days.find((row) => row.date === today);
    const chat = day?.purposes.find((row) => row.purpose === "chat-answer");
    expect(chat?.runs).toBeGreaterThanOrEqual(2);
    expect(chat?.failed).toBeGreaterThanOrEqual(1);
    expect(report.totals.inputTokens).toBeGreaterThanOrEqual(150);
    const health = await healthSummary(db);
    expect(Array.isArray(health.jobCounts)).toBe(true);
    const counts = await adminOverviewCounts(db);
    expect(counts.accounts).toBeGreaterThan(0);
  });

  it("global search returns only what the user may see", async () => {
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const word = `kestrel${randomUUID()
      .slice(0, 6)
      .replace(/[^a-z]/g, "q")}`;
    const { document } = await createDocument(db, owner.id);
    await db.execute(
      sql`update documents set title = ${`Notes on ${word}`} where id = ${document.id}`,
    );
    await db.execute(
      sql`insert into library_items (user_id, document_id) values (${owner.id}, ${document.id})`,
    );
    await db.insert(projects).values({
      ownerId: owner.id,
      title: `Essay about ${word}`,
      mode: "general",
      prompt: "",
      templateKey: "academic-report",
      status: "draft",
    });
    const mine = await globalSearch(db, owner, word);
    expect(mine.library.map((row) => row.title)).toEqual([`Notes on ${word}`]);
    expect(mine.projects.map((row) => row.title)).toEqual([`Essay about ${word}`]);
    const theirs = await globalSearch(db, stranger, word);
    expect(theirs).toEqual({ books: [], publishers: [], library: [], projects: [] });
  });
});
