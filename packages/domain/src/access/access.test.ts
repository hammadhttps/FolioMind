import { randomUUID } from "node:crypto";
import { books, collections, documents, libraryItems, workspaces } from "@foliomind/db";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createBook, createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import {
  canAddToCollection,
  canReadDocumentVersion,
  canUseWorkspaceSource,
  isAdmin,
  ownsDocument,
} from ".";

const actor = (user: { id: string; status: "active" | "suspended" | "deleting" }) => ({
  id: user.id,
  status: user.status,
});

describeWithDatabase("canReadDocumentVersion", () => {
  it("lets the owner read their own active document", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const { version } = await createDocument(db, owner.id);
    expect(await canReadDocumentVersion(db, actor(owner), version.id)).toBe(true);
  });

  it("refuses strangers, guests and admins without ownership (Section 4)", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const stranger = await createUser(db);
    const admin = await createUser(db, { role: "admin" });
    const { version } = await createDocument(db, owner.id);

    expect(await canReadDocumentVersion(db, actor(stranger), version.id)).toBe(false);
    expect(await canReadDocumentVersion(db, null, version.id)).toBe(false);
    expect(await canReadDocumentVersion(db, actor(admin), version.id)).toBe(false);
    expect(isAdmin(admin)).toBe(true);
  });

  it("lets any signed-in user read a version behind an active published revision", async () => {
    const db = testDb();
    const publisherSource = await createUser(db);
    const reader = await createUser(db);
    const { version } = await createDocument(db, publisherSource.id);
    const { book } = await createBook(db, version.id, { published: true });

    expect(await canReadDocumentVersion(db, actor(reader), version.id)).toBe(true);

    // Unpublishing revokes it immediately.
    await db.update(books).set({ status: "unpublished" }).where(eq(books.id, book.id));
    expect(await canReadDocumentVersion(db, actor(reader), version.id)).toBe(false);
  });

  it("does not open drafts or pending revisions to readers", async () => {
    const db = testDb();
    const source = await createUser(db);
    const reader = await createUser(db);
    const { version } = await createDocument(db, source.id);
    await createBook(db, version.id, { published: false });
    expect(await canReadDocumentVersion(db, actor(reader), version.id)).toBe(false);
  });

  it("refuses suspended owners and deleted documents", async () => {
    const db = testDb();
    const owner = await createUser(db, { status: "suspended" });
    const { version } = await createDocument(db, owner.id);
    expect(await canReadDocumentVersion(db, actor(owner), version.id)).toBe(false);

    const active = await createUser(db);
    const { document, version: other } = await createDocument(db, active.id);
    await db
      .update(documents)
      .set({ status: "deleting", deletedAt: new Date() })
      .where(eq(documents.id, document.id));
    expect(await canReadDocumentVersion(db, actor(active), other.id)).toBe(false);
    expect(await ownsDocument(db, actor(active), document.id)).toBe(false);
  });

  it("never derives access from a saved reference", async () => {
    const db = testDb();
    const owner = await createUser(db);
    const reader = await createUser(db);
    const { document, version } = await createDocument(db, owner.id);
    await db.insert(libraryItems).values({ userId: reader.id, documentId: document.id });
    expect(await canReadDocumentVersion(db, actor(reader), version.id)).toBe(false);
  });
});

describeWithDatabase("ownership helpers", () => {
  it("keeps collection items within one owner", async () => {
    const db = testDb();
    const alice = await createUser(db);
    const bob = await createUser(db);
    const { document } = await createDocument(db, alice.id);
    const [aliceCollection] = await db
      .insert(collections)
      .values({ userId: alice.id, name: `Reading ${randomUUID()}` })
      .returning();
    const [bobCollection] = await db
      .insert(collections)
      .values({ userId: bob.id, name: "Bob's" })
      .returning();
    const [aliceItem] = await db
      .insert(libraryItems)
      .values({ userId: alice.id, documentId: document.id })
      .returning();
    if (!aliceCollection || !bobCollection || !aliceItem) throw new Error("setup failed");

    expect(await canAddToCollection(db, actor(alice), aliceCollection.id, aliceItem.id)).toBe(true);
    expect(await canAddToCollection(db, actor(alice), bobCollection.id, aliceItem.id)).toBe(false);
    expect(await canAddToCollection(db, actor(bob), bobCollection.id, aliceItem.id)).toBe(false);
  });

  it("requires both workspace ownership and source access", async () => {
    const db = testDb();
    const alice = await createUser(db);
    const bob = await createUser(db);
    const { version: aliceVersion } = await createDocument(db, alice.id);
    const { version: bobVersion } = await createDocument(db, bob.id);
    const [workspace] = await db
      .insert(workspaces)
      .values({ ownerId: alice.id, name: "Research" })
      .returning();
    if (!workspace) throw new Error("setup failed");

    expect(await canUseWorkspaceSource(db, actor(alice), workspace.id, aliceVersion.id)).toBe(true);
    expect(await canUseWorkspaceSource(db, actor(alice), workspace.id, bobVersion.id)).toBe(false);
    expect(await canUseWorkspaceSource(db, actor(bob), workspace.id, bobVersion.id)).toBe(false);
  });

  it("rejects a second target and duplicate saves at the database level", async () => {
    const db = testDb();
    const user = await createUser(db);
    const { document, version } = await createDocument(db, user.id);
    const { book } = await createBook(db, version.id, { published: true });
    await expect(
      db.insert(libraryItems).values({ userId: user.id, documentId: document.id, bookId: book.id }),
    ).rejects.toThrow();
    await db.insert(libraryItems).values({ userId: user.id, bookId: book.id });
    await expect(
      db.insert(libraryItems).values({ userId: user.id, bookId: book.id }),
    ).rejects.toThrow();
  });
});
