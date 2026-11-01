import { randomUUID } from "node:crypto";
import { usageBuckets, usageOperations } from "@foliomind/db";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import { commit, expireAbandoned, ownedSourceCount, release, reserve, storageBytesUsed } from ".";

const key = () => `test-op-${randomUUID()}`;

async function bucketFor(userId: string, metric: string) {
  const [bucket] = await testDb()
    .select()
    .from(usageBuckets)
    .where(and(eq(usageBuckets.userId, userId), eq(usageBuckets.metric, metric)));
  return bucket;
}

describeWithDatabase("usage reservations", () => {
  it("never oversubscribes under many parallel reservations", async () => {
    const db = testDb();
    const user = await createUser(db);
    // Free allows 5 web article imports per month.
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        reserve(db, { userId: user.id, metric: "url_imports", quantity: 1, operationKey: key() }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(5);
    const refused = results.filter((result) => !result.ok);
    expect(refused).toHaveLength(20);
    expect(refused[0]).toMatchObject({ code: "quota_exceeded", limit: 5, used: 5 });

    const bucket = await bucketFor(user.id, "url_imports");
    expect(bucket).toMatchObject({ limit: 5, reserved: 5, consumed: 0 });
    const operations = await db
      .select()
      .from(usageOperations)
      .where(eq(usageOperations.bucketId, bucket!.id));
    expect(operations).toHaveLength(5);
  });

  it("uses a lazily created UTC calendar-month bucket", async () => {
    const db = testDb();
    const user = await createUser(db);
    await reserve(db, {
      userId: user.id,
      metric: "ai_questions",
      quantity: 1,
      operationKey: key(),
      now: new Date("2026-03-31T23:30:00-05:00"), // already April in UTC
    });
    const bucket = await bucketFor(user.id, "ai_questions");
    expect(bucket?.periodStart.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(bucket?.periodEnd.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(bucket?.limit).toBe(30);
  });

  it("is idempotent per operation key and moves reserved to consumed on commit", async () => {
    const db = testDb();
    const user = await createUser(db);
    const operationKey = key();
    const first = await reserve(db, {
      userId: user.id,
      metric: "ai_questions",
      quantity: 2,
      operationKey,
    });
    const replay = await reserve(db, {
      userId: user.id,
      metric: "ai_questions",
      quantity: 2,
      operationKey,
    });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(await bucketFor(user.id, "ai_questions")).toMatchObject({ reserved: 2, consumed: 0 });

    expect(await commit(db, operationKey)).toMatchObject({ ok: true, replayed: false });
    expect(await commit(db, operationKey)).toMatchObject({ ok: true, replayed: true });
    expect(await bucketFor(user.id, "ai_questions")).toMatchObject({ reserved: 0, consumed: 2 });
    expect(await release(db, operationKey)).toEqual({ ok: false, code: "operation_committed" });
  });

  it("returns released reservations to the allowance", async () => {
    const db = testDb();
    const user = await createUser(db);
    const keys = Array.from({ length: 5 }, key);
    for (const operationKey of keys) {
      await reserve(db, { userId: user.id, metric: "url_imports", quantity: 1, operationKey });
    }
    expect(
      await reserve(db, {
        userId: user.id,
        metric: "url_imports",
        quantity: 1,
        operationKey: key(),
      }),
    ).toMatchObject({ ok: false, code: "quota_exceeded" });

    expect(await release(db, keys[0]!)).toMatchObject({ ok: true, replayed: false });
    expect(await release(db, keys[0]!)).toMatchObject({ ok: true, replayed: true });
    expect(
      await reserve(db, {
        userId: user.id,
        metric: "url_imports",
        quantity: 1,
        operationKey: key(),
      }),
    ).toMatchObject({ ok: true });
    // A released key never reserves again.
    expect(
      await reserve(db, {
        userId: user.id,
        metric: "url_imports",
        quantity: 1,
        operationKey: keys[0]!,
      }),
    ).toEqual({ ok: false, code: "operation_released" });
  });

  it("expires abandoned reservations", async () => {
    const db = testDb();
    const user = await createUser(db);
    const now = new Date();
    const stale = key();
    const fresh = key();
    await reserve(db, {
      userId: user.id,
      metric: "reexports",
      quantity: 3,
      operationKey: stale,
      expiresAt: new Date(now.getTime() - 1000),
    });
    await reserve(db, { userId: user.id, metric: "reexports", quantity: 1, operationKey: fresh });

    const touched = await expireAbandoned(db, { now });
    expect(touched.some((ref) => ref.userId === user.id)).toBe(true);
    expect(await bucketFor(user.id, "reexports")).toMatchObject({ reserved: 1, consumed: 0 });
    expect(await commit(db, stale)).toEqual({ ok: false, code: "operation_released" });
    expect(await commit(db, fresh)).toMatchObject({ ok: true });
  });

  it("measures storage and owned sources as gauges", async () => {
    const db = testDb();
    const user = await createUser(db);
    expect(await storageBytesUsed(db, user.id)).toBe(0);
    await createDocument(db, user.id);
    await createDocument(db, user.id);
    expect(await storageBytesUsed(db, user.id)).toBe(2000);
    expect(await ownedSourceCount(db, user.id)).toBe(2);
  });
});
