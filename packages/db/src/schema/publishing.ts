import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, timestamptz, tsvector } from "./columns";
import { bookRevisionStatus, bookStatus, publisherStatus, reportStatus } from "./enums";
import { assets, documentVersions } from "./files";
import { users } from "./identity";

/* Section 12 "Identity and publishing": publishers, catalog books and moderation. */

export const publisherProfiles = pgTable(
  "publisher_profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull(),
    website: text("website"),
    status: publisherStatus("status").notNull().default("applicant"),
    applicationNote: text("application_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewReason: text("review_reason"),
    ...timestamps(),
  },
  (t) => [index("publisher_profiles_status_idx").on(t.status, t.createdAt, t.id)],
);

export const publisherFollows = pgTable(
  "publisher_follows",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publisherProfiles.id, { onDelete: "cascade" }),
    notify: boolean("notify").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.publisherId] }),
    index("publisher_follows_publisher_idx").on(t.publisherId),
  ],
);

export const books = pgTable(
  "books",
  {
    id: id(),
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publisherProfiles.id),
    status: bookStatus("status").notNull().default("draft"),
    /** Set after the first approval; must be a revision of this book (composite FK below). */
    publishedRevisionId: uuid("published_revision_id"),
    deletedAt: timestamptz("deleted_at"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "books_published_revision_fk",
      columns: [t.id, t.publishedRevisionId],
      foreignColumns: [bookRevisions.bookId, bookRevisions.id],
    }),
    // Publisher dashboard: recently updated (Section 24).
    index("books_publisher_updated_idx").on(
      t.publisherId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("books_published_revision_idx").on(t.publishedRevisionId),
  ],
);

export const bookRevisions = pgTable(
  "book_revisions",
  {
    id: id(),
    bookId: uuid("book_id")
      .notNull()
      .references((): AnyPgColumn => books.id, { onDelete: "cascade" }),
    revisionNo: integer("revision_no").notNull(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    author: text("author").notNull(),
    language: text("language").notNull(),
    coverAssetId: uuid("cover_asset_id").references(() => assets.id, { onDelete: "set null" }),
    licenseStatement: text("license_statement").notNull(),
    status: bookRevisionStatus("status").notNull().default("draft"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewReason: text("review_reason"),
    publishedAt: timestamptz("published_at"),
    /** Title (A), author (B) and description (C) for catalog search (Section 24). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english'::regconfig, coalesce(${bookRevisions.title}, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(${bookRevisions.author}, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(${bookRevisions.description}, '')), 'C')`,
    ),
    ...timestamps(),
  },
  (t) => [
    unique("book_revisions_book_revision_no_key").on(t.bookId, t.revisionNo),
    // Target of books_published_revision_fk: a published revision belongs to its book.
    unique("book_revisions_book_id_id_key").on(t.bookId, t.id),
    check("book_revisions_revision_no_check", sql`${t.revisionNo} >= 1`),
    index("book_revisions_document_version_idx").on(t.documentVersionId),
    // Published catalog, newest first (Section 24).
    index("book_revisions_published_idx")
      .on(t.publishedAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.publishedAt} is not null`),
    // Moderation queue: oldest pending first.
    index("book_revisions_status_idx").on(t.status, t.createdAt, t.id),
    index("book_revisions_search_idx").using("gin", t.searchVector),
    // Typo-tolerant fallback on title and author.
    index("book_revisions_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("book_revisions_author_trgm_idx").using("gin", t.author.op("gin_trgm_ops")),
  ],
);

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps(),
});

/** Categories stay attached to the moderated revision. */
export const bookRevisionCategories = pgTable(
  "book_revision_categories",
  {
    bookRevisionId: uuid("book_revision_id")
      .notNull()
      .references(() => bookRevisions.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
  },
  (t) => [
    primaryKey({ columns: [t.bookRevisionId, t.categoryId] }),
    index("book_revision_categories_category_idx").on(t.categoryId),
  ],
);

export const contentReports = pgTable(
  "content_reports",
  {
    id: id(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id),
    reason: text("reason").notNull(),
    status: reportStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolution: text("resolution"),
    ...timestamps(),
  },
  (t) => [
    // Moderation queue: oldest open first.
    index("content_reports_status_idx").on(t.status, t.createdAt, t.id),
    index("content_reports_book_idx").on(t.bookId),
    index("content_reports_reporter_idx").on(t.reporterId),
  ],
);
