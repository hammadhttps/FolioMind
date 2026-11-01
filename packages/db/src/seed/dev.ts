import { INDEX_EMBEDDING_DIMENSION } from "@foliomind/contracts";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import { isLocalDatabaseUrl } from "../migrate";
import {
  assets,
  bookRevisionCategories,
  bookRevisions,
  books,
  categories,
  documents,
  documentVersions,
  publisherProfiles,
  userPreferences,
  users,
} from "../schema";

/*
 * Development fixtures for catalog work in later phases: one approved sample
 * publisher with three published sample books. Every title says "Sample" and the
 * files behind them do not exist, so nothing here can pass for real content.
 * Fixed IDs keep the seed idempotent.
 */

const PUBLISHER_USER_ID = "5eed0000-0000-4000-8000-000000000001";
const PUBLISHER_ID = "5eed0000-0000-4000-8000-000000000002";

const SAMPLE_BOOKS = [
  {
    n: 1,
    title: "Sample: Field Notes on River Restoration",
    author: "Sample Author One",
    description:
      "Sample catalog entry for local development. Placeholder metadata about restoring river habitats; there is no real book behind it.",
    category: "environment",
  },
  {
    n: 2,
    title: "Sample: Shapes, Grids and Margins",
    author: "Sample Author Two",
    description:
      "Sample catalog entry for local development. Placeholder metadata about page layout and typography; there is no real book behind it.",
    category: "design",
  },
  {
    n: 3,
    title: "Sample: Asking Better Research Questions",
    author: "Sample Author Three",
    description:
      "Sample catalog entry for local development. Placeholder metadata about framing research questions; there is no real book behind it.",
    category: "research",
  },
] as const;

const sampleId = (kind: number, n: number) =>
  `5eed${String(kind).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export class DevSeedRefusedError extends Error {}

/** The dev seed only ever touches a local database outside production. */
export function assertDevSeedAllowed(url: string, env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === "production") {
    throw new DevSeedRefusedError("The dev seed never runs with NODE_ENV=production.");
  }
  if (env.APP_ENV === "staging" || env.APP_ENV === "production") {
    throw new DevSeedRefusedError(`The dev seed never runs with APP_ENV=${env.APP_ENV}.`);
  }
  if (!isLocalDatabaseUrl(url)) {
    throw new DevSeedRefusedError("The dev seed only runs against a local database.");
  }
}

export async function seedDev(db: Database): Promise<{ books: number }> {
  return db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: PUBLISHER_USER_ID,
        auth0Sub: "dev-seed|sample-publisher",
        email: "sample-publisher@example.com",
        emailVerified: true,
        displayName: "Sample Publisher (dev data)",
        role: "publisher",
      })
      .onConflictDoNothing();
    await tx.insert(userPreferences).values({ userId: PUBLISHER_USER_ID }).onConflictDoNothing();
    await tx
      .insert(publisherProfiles)
      .values({
        id: PUBLISHER_ID,
        userId: PUBLISHER_USER_ID,
        slug: "sample-press",
        displayName: "Sample Press (dev data)",
        bio: "A sample publisher created by the development seed. It is not a real organization.",
        status: "approved",
      })
      .onConflictDoNothing();

    const categoryRows = await tx
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(
        inArray(
          categories.slug,
          SAMPLE_BOOKS.map((book) => book.category),
        ),
      );
    const categoryId = new Map(categoryRows.map((row) => [row.slug, row.id]));

    for (const book of SAMPLE_BOOKS) {
      const assetId = sampleId(10, book.n);
      const documentId = sampleId(11, book.n);
      const versionId = sampleId(12, book.n);
      const bookId = sampleId(13, book.n);
      const revisionId = sampleId(14, book.n);

      await tx
        .insert(assets)
        .values({
          id: assetId,
          ownerId: PUBLISHER_USER_ID,
          fileKey: `dev-seed-missing-file-${book.n}`,
          customId: `dev-seed-${book.n}`,
          fileRoute: "bookSourcePdf",
          acl: "private",
          purpose: "source",
          bytes: 0,
          mimeType: "application/pdf",
          state: "ready",
        })
        .onConflictDoNothing();
      await tx
        .insert(documents)
        .values({
          id: documentId,
          ownerId: PUBLISHER_USER_ID,
          title: book.title,
          sourceKind: "upload",
        })
        .onConflictDoNothing();
      await tx
        .insert(documentVersions)
        .values({
          id: versionId,
          documentId,
          versionNo: 1,
          assetId,
          sha256: "dev-seed",
          pageCount: 0,
          language: "en",
          status: "ready",
          indexVersion: "dev-seed",
          embeddingModel: "none",
          embeddingDimension: INDEX_EMBEDDING_DIMENSION,
        })
        .onConflictDoNothing();
      await tx
        .update(documents)
        .set({ currentVersionId: versionId })
        .where(eq(documents.id, documentId));
      await tx
        .insert(books)
        .values({ id: bookId, publisherId: PUBLISHER_ID, status: "published" })
        .onConflictDoNothing();
      await tx
        .insert(bookRevisions)
        .values({
          id: revisionId,
          bookId,
          revisionNo: 1,
          documentVersionId: versionId,
          title: book.title,
          description: book.description,
          author: book.author,
          language: "en",
          licenseStatement: "Sample license statement for development data only.",
          status: "approved",
          publishedAt: new Date(Date.UTC(2026, 0, book.n)),
        })
        .onConflictDoNothing();
      const category = categoryId.get(book.category);
      if (category) {
        await tx
          .insert(bookRevisionCategories)
          .values({ bookRevisionId: revisionId, categoryId: category })
          .onConflictDoNothing();
      }
      await tx.update(books).set({ publishedRevisionId: revisionId }).where(eq(books.id, bookId));
    }

    return { books: SAMPLE_BOOKS.length };
  });
}
