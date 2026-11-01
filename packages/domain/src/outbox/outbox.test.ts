import { randomUUID } from "node:crypto";
import { EVENT_NAMES } from "@foliomind/contracts";
import { outboxEvents } from "@foliomind/db";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { describeWithDatabase, testDb } from "../test/db";
import { deliverPending, enqueue, outboxBackoffMs } from ".";

const ping = (key: string) => ({
  key,
  name: EVENT_NAMES.systemPingRequested,
  data: { requestedAt: new Date().toISOString(), source: "outbox-test" },
});

class Rollback extends Error {}

describeWithDatabase("outbox", () => {
  it("leaves nothing behind when the enqueuing transaction rolls back", async () => {
    const db = testDb();
    const key = `test-${randomUUID()}`;
    await expect(
      db.transaction(async (tx) => {
        await enqueue(tx, ping(key));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, key))).toHaveLength(
      0,
    );
  });

  it("validates payloads and dedupes by key", async () => {
    const db = testDb();
    const key = `test-${randomUUID()}`;
    await expect(
      enqueue(db, {
        key,
        name: EVENT_NAMES.systemPingRequested,
        data: { requestedAt: "soon", source: "" },
      }),
    ).rejects.toThrow();
    await enqueue(db, ping(key));
    await enqueue(db, ping(key));
    expect(await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, key))).toHaveLength(
      1,
    );
  });

  it("delivers with the outbox key as the event ID and marks rows delivered", async () => {
    const db = testDb();
    const key = `test-${randomUUID()}`;
    await db.transaction((tx) => enqueue(tx, ping(key)));
    const send = vi.fn().mockResolvedValue(undefined);

    expect(await deliverPending(db, send, { keys: [key] })).toEqual({ delivered: 1, failed: 0 });
    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({ id: key, name: EVENT_NAMES.systemPingRequested }),
    ]);
    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, key));
    expect(row?.deliveredAt).toBeInstanceOf(Date);
    expect(row?.leaseUntil).toBeNull();
    // Delivered rows are never sent again.
    expect(await deliverPending(db, send, { keys: [key] })).toEqual({ delivered: 0, failed: 0 });
  });

  it("backs off after a failed send and retries once due", async () => {
    const db = testDb();
    const key = `test-${randomUUID()}`;
    await enqueue(db, ping(key));
    // Explicit clock, a second ahead so the just-enqueued row is due.
    const now = new Date(Date.now() + 1000);
    const failing = vi.fn().mockRejectedValue(new Error("inngest down"));

    expect(await deliverPending(db, failing, { keys: [key], now })).toEqual({
      delivered: 0,
      failed: 1,
    });
    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.eventKey, key));
    expect(row?.attempts).toBe(1);
    expect(row?.availableAt.getTime()).toBe(now.getTime() + outboxBackoffMs(1));

    const send = vi.fn().mockResolvedValue(undefined);
    expect(await deliverPending(db, send, { keys: [key], now })).toEqual({
      delivered: 0,
      failed: 0,
    });
    const later = new Date(now.getTime() + outboxBackoffMs(1) + 1);
    expect(await deliverPending(db, send, { keys: [key], now: later })).toEqual({
      delivered: 1,
      failed: 0,
    });
  });

  it("never hands one row to two concurrent dispatchers", async () => {
    const db = testDb();
    const keys = Array.from({ length: 10 }, () => `test-${randomUUID()}`);
    for (const key of keys) await enqueue(db, ping(key));
    const sent: string[] = [];
    const send = vi.fn(async (events: { id: string }[]) => {
      sent.push(...events.map((event) => event.id));
    });
    await Promise.all([
      deliverPending(db, send, { keys }),
      deliverPending(db, send, { keys }),
      deliverPending(db, send, { keys }),
    ]);
    expect(sent.sort()).toEqual([...keys].sort());
  });
});
