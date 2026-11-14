import { z } from "zod";

/*
 * The public catalog (blueprint Sections 5 rows 1–4, 20, 23 and 24): what
 * Explore, Book Details, Publisher Profile, Home and global search show, and
 * the cached shapes behind them. Only approved, published listings appear.
 */

export const catalogCategorySchema = z.object({ slug: z.string(), name: z.string() });
export type CatalogCategory = z.infer<typeof catalogCategorySchema>;

export const catalogPublisherRefSchema = z.object({ slug: z.string(), name: z.string() });

/** One card in Explore, Publisher Profile and Home. */
export const catalogBookCardSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  author: z.string(),
  language: z.string(),
  coverUrl: z.string().nullable(),
  categories: z.array(catalogCategorySchema),
  publisher: catalogPublisherRefSchema,
  publishedAt: z.string(),
});
export type CatalogBookCard = z.infer<typeof catalogBookCardSchema>;

/** Section 23: result IDs and the total, cached per normalized params and catalog version. */
export const catalogResultIdsSchema = z.object({
  ids: z.array(z.uuid()),
  total: z.number().int().min(0),
});
export type CatalogResultIds = z.infer<typeof catalogResultIdsSchema>;

/** Section 23: category, language and publisher facets, cached for an hour. */
export const catalogFacetsSchema = z.object({
  categories: z.array(catalogCategorySchema.extend({ count: z.number().int() })),
  languages: z.array(z.object({ code: z.string(), name: z.string(), count: z.number().int() })),
  publishers: z.array(catalogPublisherRefSchema.extend({ count: z.number().int() })),
});
export type CatalogFacets = z.infer<typeof catalogFacetsSchema>;

/** Book Details (Section 5 row 3). */
export const publicBookSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  title: z.string(),
  author: z.string(),
  description: z.string(),
  language: z.string(),
  categories: z.array(catalogCategorySchema),
  publisher: catalogPublisherRefSchema,
  coverUrl: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  licenseStatement: z.string(),
  /** When this revision was approved: the listing's "Updated" date. */
  publishedAt: z.string(),
  /** The Reader opens this document's published version. */
  documentId: z.uuid(),
  versionId: z.uuid(),
});
export type PublicBook = z.infer<typeof publicBookSchema>;

/** Publisher Profile (Section 5 row 4): no private analytics or contact data. */
export const publicPublisherSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  bio: z.string(),
  website: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bookCount: z.number().int(),
});
export type PublicPublisher = z.infer<typeof publicPublisherSchema>;

/** Home "featured" shows this many of the newest approved books (Section 5 row 1). */
export const FEATURED_BOOK_COUNT = 6;

/* --- Global search (⌘K) ---------------------------------------------------- */

export const GLOBAL_SEARCH_LIMIT = 5;

export const globalSearchResponseSchema = z.object({
  books: z.array(
    z.object({ id: z.uuid(), title: z.string(), author: z.string(), href: z.string() }),
  ),
  publishers: z.array(z.object({ slug: z.string(), name: z.string(), href: z.string() })),
  library: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      kind: z.enum(["upload", "imported", "saved"]),
      href: z.string(),
    }),
  ),
  projects: z.array(z.object({ id: z.uuid(), title: z.string(), href: z.string() })),
});
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;

/** Signed-in reader state on Book Details and Publisher Profile. */
export interface BookViewerState {
  saved: boolean;
  /** The viewer's own open or decided report, so they can see its status. */
  report: { status: "open" | "resolved" | "dismissed"; createdAt: string } | null;
  isOwner: boolean;
}

export interface FollowState {
  following: boolean;
  notify: boolean;
  isOwner: boolean;
}
