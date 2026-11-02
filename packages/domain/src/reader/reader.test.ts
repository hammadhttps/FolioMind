import { expect, it } from "vitest";
import { createCollection, deleteCollection, updateCollection } from "../collections";
import { createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import {
  createAnnotation,
  deleteAnnotation,
  getReadingProgress,
  listAnnotations,
  saveReadingProgress,
  toggleBookmark,
  updateAnnotation,
} from ".";

const actor = (user: { id: string; status: "active" | "suspended" | "deleting" }) => ({
  id: user.id,
  status: user.status,
});

const highlight = {
  kind: "highlight" as const,
  anchor: {
    page: 2,
    text: "rivers carry sediment",
    start: 10,
    end: 31,
    rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
  },
  color: "mint" as const,
};

describeWithDatabase("annotations and progress", () => {
  it("lets the reader create, edit, list and delete their own annotations", async () => {
    const db = testDb();
    const user = await createUser(db);
    const { version } = await createDocument(db, user.id);

    const created = await createAnnotation(db, actor(user), {
      versionId: version.id,
      ...highlight,
    });
    expect(created).toMatchObject({ kind: "highlight", pageNumber: 2, color: "mint" });
    const note = await createAnnotation(db, actor(user), {
      versionId: version.id,
      kind: "note",
      anchor: { page: 1 },
      body: "Check the methods section.",
    });
    expect(note?.body).toBe("Check the methods section.");

    expect(
      await updateAnnotation(db, actor(user), created!.id, { color: "yellow", body: "Key claim" }),
    ).toMatchObject({
      color: "yellow",
      body: "Key claim",
    });
    expect((await listAnnotations(db, user.id, version.id)).map((row) => row.pageNumber)).toEqual([
      1, 2,
    ]);
    expect(await deleteAnnotation(db, actor(user), note!.id)).toBe(true);
    expect(await listAnnotations(db, user.id, version.id)).toHaveLength(1);
  });

  it("refuses annotations on versions the actor cannot read, and others' annotations", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const { version } = await createDocument(db, owner.id);

    expect(
      await createAnnotation(db, actor(stranger), { versionId: version.id, ...highlight }),
    ).toBeNull();
    expect(
      await toggleBookmark(db, actor(stranger), { versionId: version.id, pageNumber: 1 }),
    ).toBeNull();
    expect(
      await saveReadingProgress(db, actor(stranger), {
        versionId: version.id,
        pageNumber: 1,
        position: { scale: 1, offset: 0 },
      }),
    ).toBe(false);

    const mine = await createAnnotation(db, actor(owner), { versionId: version.id, ...highlight });
    expect(await updateAnnotation(db, actor(stranger), mine!.id, { body: "x" })).toBeNull();
    expect(await deleteAnnotation(db, actor(stranger), mine!.id)).toBe(false);
  });

  it("toggles one bookmark per page and upserts reading progress", async () => {
    const db = testDb();
    const user = await createUser(db);
    const { version } = await createDocument(db, user.id);

    expect(
      await toggleBookmark(db, actor(user), { versionId: version.id, pageNumber: 3 }),
    ).toMatchObject({
      bookmarked: true,
    });
    expect(await toggleBookmark(db, actor(user), { versionId: version.id, pageNumber: 3 })).toEqual(
      {
        bookmarked: false,
        annotation: null,
      },
    );

    await saveReadingProgress(db, actor(user), {
      versionId: version.id,
      pageNumber: 2,
      position: { scale: "page-width", offset: 0.4 },
    });
    await saveReadingProgress(db, actor(user), {
      versionId: version.id,
      pageNumber: 7,
      position: { scale: 1.25, offset: 0.1, pageCount: 20 },
    });
    expect(await getReadingProgress(db, user.id, version.id)).toMatchObject({
      pageNumber: 7,
      position: { scale: 1.25, offset: 0.1, pageCount: 20 },
    });
  });
});

describeWithDatabase("collections", () => {
  it("keeps names unique per user, case-insensitively, and only for their owner", async () => {
    const db = testDb();
    const user = await createUser(db);
    const other = await createUser(db);
    const created = await createCollection(db, actor(user), { name: "Thesis" });
    expect(created.ok).toBe(true);
    expect(await createCollection(db, actor(user), { name: "thesis" })).toEqual({
      ok: false,
      code: "name_taken",
    });
    expect((await createCollection(db, actor(other), { name: "Thesis" })).ok).toBe(true);
    if (!created.ok) return;
    expect(await updateCollection(db, actor(other), created.id, { name: "Mine now" })).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(await deleteCollection(db, actor(other), created.id)).toBe(false);
    expect(await deleteCollection(db, actor(user), created.id)).toBe(true);
  });
});
