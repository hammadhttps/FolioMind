import { randomUUID } from "node:crypto";
import {
  assets,
  bookRevisions,
  books,
  createDb,
  documents,
  documentVersions,
  publisherProfiles,
  userPreferences,
  users,
  type Database,
} from "@foliomind/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, inject } from "vitest";
import { TEST_DATABASE_URL } from "./env";

/*
 * Helpers for integration tests. Every test creates its own users and rows with
 * random identifiers, so files never depend on each other's data.
 */

/** `describe` that skips (with the global setup's warning) when Postgres is down. */
export const describeWithDatabase = describe.skipIf(!inject("databaseReady"));

let connection: ReturnType<typeof createDb> | undefined;

/** One pool per test file, closed after the file finishes. */
export function testDb(): Database {
  if (!connection) {
    connection = createDb({ url: TEST_DATABASE_URL, role: "worker", max: 20 });
    afterAll(async () => {
      await connection?.close();
      connection = undefined;
    });
  }
  return connection.db;
}

export const uniqueEmail = () => `user-${randomUUID()}@example.com`;

export async function createUser(
  db: Database,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
  const [user] = await db
    .insert(users)
    .values({
      auth0Sub: `google-oauth2|${randomUUID()}`,
      email: uniqueEmail(),
      emailVerified: true,
      displayName: "Test Reader",
      ...overrides,
    })
    .returning();
  if (!user) throw new Error("user insert failed");
  await db.insert(userPreferences).values({ userId: user.id }).onConflictDoNothing();
  return user;
}

/** A private uploaded document with one version, owned by `ownerId`. */
export async function createDocument(db: Database, ownerId: string) {
  const [asset] = await db
    .insert(assets)
    .values({
      ownerId,
      fileKey: `test-${randomUUID()}`,
      customId: `test-${randomUUID()}`,
      fileRoute: "sourcePdf",
      acl: "private",
      purpose: "source",
      bytes: 1000,
      mimeType: "application/pdf",
      state: "ready",
    })
    .returning();
  const [document] = await db
    .insert(documents)
    .values({ ownerId, title: "Test document", sourceKind: "upload" })
    .returning();
  if (!asset || !document) throw new Error("document insert failed");
  const [version] = await db
    .insert(documentVersions)
    .values({
      documentId: document.id,
      versionNo: 1,
      assetId: asset.id,
      sha256: "test",
      status: "ready",
      indexVersion: "test",
      embeddingModel: "test",
      embeddingDimension: 1024,
    })
    .returning();
  if (!version) throw new Error("version insert failed");
  await db
    .update(documents)
    .set({ currentVersionId: version.id })
    .where(eq(documents.id, document.id));
  return { asset, document, version };
}

/** A book by a new approved publisher whose revision references `versionId`. */
export async function createBook(
  db: Database,
  versionId: string,
  { published }: { published: boolean },
) {
  const publisherUser = await createUser(db, { role: "publisher" });
  const [publisher] = await db
    .insert(publisherProfiles)
    .values({
      userId: publisherUser.id,
      slug: `press-${randomUUID()}`,
      displayName: "Test Press",
      bio: "Test publisher",
      status: "approved",
    })
    .returning();
  if (!publisher) throw new Error("publisher insert failed");
  const [book] = await db
    .insert(books)
    .values({ publisherId: publisher.id, status: published ? "published" : "draft" })
    .returning();
  if (!book) throw new Error("book insert failed");
  const [revision] = await db
    .insert(bookRevisions)
    .values({
      bookId: book.id,
      revisionNo: 1,
      documentVersionId: versionId,
      title: "Test book",
      description: "Test description",
      author: "Test author",
      language: "en",
      licenseStatement: "Test license",
      status: published ? "approved" : "pending",
      publishedAt: published ? new Date() : null,
    })
    .returning();
  if (!revision) throw new Error("revision insert failed");
  if (published) {
    await db.update(books).set({ publishedRevisionId: revision.id }).where(eq(books.id, book.id));
  }
  return { book, revision };
}
