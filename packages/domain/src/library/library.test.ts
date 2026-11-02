import { documents, documentVersions, readingProgress } from "@foliomind/db";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { setCollectionMembership, createCollection, listCollections } from "../collections";
import { createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import { continueReading, dashboardCounts, decodeCursor, listLibrary } from ".";
import { libraryItems } from "@foliomind/db";

const base = { type: "all", status: "all", sort: "added", limit: 24 } as const;

async function libraryWith(titles: string[]) {
  const db = testDb();
  const user = await createUser(db);
  const docs = [];
  for (const title of titles) {
    const created = await createDocument(db, user.id);
    await db.update(documents).set({ title }).where(eq(documents.id, created.document.id));
    await db.insert(libraryItems).values({ userId: user.id, documentId: created.document.id });
    docs.push(created);
  }
  return { user, docs };
}

describeWithDatabase("listLibrary", () => {
  it("lists only the user's active items, newest first, with Load more cursors", async () => {
    const db = testDb();
    const { user } = await libraryWith(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]);
    const other = await libraryWith(["Not mine"]);
    void other;

    const first = await listLibrary(db, { ...base, userId: user.id, limit: 2 });
    expect(first.items.map((item) => item.title)).toEqual(["Epsilon", "Delta"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listLibrary(db, {
      ...base,
      userId: user.id,
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.title)).toEqual(["Gamma", "Beta"]);
    const third = await listLibrary(db, {
      ...base,
      userId: user.id,
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(third.items.map((item) => item.title)).toEqual(["Alpha"]);
    expect(third.nextCursor).toBeNull();
  });

  it("sorts by title and searches titles", async () => {
    const db = testDb();
    const { user } = await libraryWith(["rivers", "Atlas", "Margins of Error"]);
    const byTitle = await listLibrary(db, { ...base, userId: user.id, sort: "title" });
    expect(byTitle.items.map((item) => item.title)).toEqual([
      "Atlas",
      "Margins of Error",
      "rivers",
    ]);
    const found = await listLibrary(db, { ...base, userId: user.id, q: "MARGIN" });
    expect(found.items.map((item) => item.title)).toEqual(["Margins of Error"]);
    const literal = await listLibrary(db, { ...base, userId: user.id, q: "%_" });
    expect(literal.items).toEqual([]);
  });

  it("filters by status and puts recently opened first", async () => {
    const db = testDb();
    const { user, docs } = await libraryWith(["Ready one", "Queued one", "Failed one"]);
    await db
      .update(documentVersions)
      .set({ status: "queued" })
      .where(eq(documentVersions.id, docs[1]!.version.id));
    await db
      .update(documentVersions)
      .set({ status: "needs_ocr" })
      .where(eq(documentVersions.id, docs[2]!.version.id));

    const titles = async (status: "ready" | "processing" | "attention") =>
      (await listLibrary(db, { ...base, userId: user.id, status })).items.map((item) => item.title);
    expect(await titles("ready")).toEqual(["Ready one"]);
    expect(await titles("processing")).toEqual(["Queued one"]);
    expect(await titles("attention")).toEqual(["Failed one"]);

    await db.insert(readingProgress).values({
      userId: user.id,
      documentVersionId: docs[0]!.version.id,
      pageNumber: 4,
      position: { scale: 1, offset: 0, pageCount: 12 },
    });
    const opened = await listLibrary(db, { ...base, userId: user.id, sort: "opened" });
    expect(opened.items[0]).toMatchObject({ title: "Ready one", status: "ready" });
    expect(opened.items[0]?.lastOpenedAt).toBeInstanceOf(Date);

    expect(await continueReading(db, user.id)).toEqual([
      expect.objectContaining({ title: "Ready one", pageNumber: 4, pageCount: 12 }),
    ]);
  });

  it("filters by the user's own collections only", async () => {
    const db = testDb();
    const { user } = await libraryWith(["Kept", "Other"]);
    const actor = { id: user.id, status: "active" as const };
    const created = await createCollection(db, actor, { name: "Thesis" });
    if (!created.ok) throw new Error(created.code);
    const all = await listLibrary(db, { ...base, userId: user.id });
    const kept = all.items.find((item) => item.title === "Kept")!;
    expect(
      await setCollectionMembership(db, actor, {
        collectionId: created.id,
        libraryItemId: kept.id,
        member: true,
      }),
    ).toBe(true);

    const filtered = await listLibrary(db, { ...base, userId: user.id, collectionId: created.id });
    expect(filtered.items.map((item) => item.title)).toEqual(["Kept"]);
    expect(filtered.items[0]?.collectionIds).toEqual([created.id]);
    expect(await listCollections(db, user.id)).toEqual([
      { id: created.id, name: "Thesis", description: null, itemCount: 1 },
    ]);

    const stranger = await libraryWith(["Theirs"]);
    const theirs = await listLibrary(db, {
      ...base,
      userId: stranger.user.id,
      collectionId: created.id,
    });
    expect(theirs.items).toEqual([]);
  });

  it("treats tampered cursors as the first page", async () => {
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"v":"x","id":"drop table"}').toString("base64url")),
    ).toBeNull();
  });

  it("counts real dashboard figures", async () => {
    const db = testDb();
    const { user } = await libraryWith(["One", "Two"]);
    expect(await dashboardCounts(db, user.id)).toEqual({
      documents: 2,
      savedBooks: 0,
      workspaces: 0,
      projects: 0,
    });
  });
});
