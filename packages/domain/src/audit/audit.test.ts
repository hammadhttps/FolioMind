import { randomUUID } from "node:crypto";
import { auditLogs } from "@foliomind/db";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describeWithDatabase, testDb } from "../test/db";
import { writeAudit } from ".";

describeWithDatabase("writeAudit", () => {
  it("commits and rolls back with the caller's transaction", async () => {
    const db = testDb();
    const kept = randomUUID();
    const dropped = randomUUID();
    await db.transaction((tx) =>
      writeAudit(tx, {
        actorId: null,
        action: "identity.linked",
        targetType: "user",
        targetId: kept,
        metadata: { provider: "github" },
      }),
    );
    await db
      .transaction(async (tx) => {
        await writeAudit(tx, {
          actorId: null,
          action: "identity.unlinked",
          targetType: "user",
          targetId: dropped,
        });
        throw new Error("rollback");
      })
      .catch(() => {});

    expect(await db.select().from(auditLogs).where(eq(auditLogs.targetId, kept))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.targetId, dropped))).toHaveLength(
      0,
    );
  });

  it("accepts only short, flat, primitive metadata", async () => {
    const db = testDb();
    const entry = {
      actorId: null,
      action: "identity.linked" as const,
      targetType: "user",
      targetId: randomUUID(),
    };
    await expect(
      writeAudit(db, { ...entry, metadata: { note: "x".repeat(201) } }),
    ).rejects.toThrow();
    await expect(
      writeAudit(db, { ...entry, metadata: { nested: { a: 1 } } as never }),
    ).rejects.toThrow();
    await expect(writeAudit(db, { ...entry, metadata: { "bad key": 1 } })).rejects.toThrow();
  });
});
