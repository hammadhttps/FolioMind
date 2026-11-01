import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, timestamptz } from "./columns";
import { annotationKind } from "./enums";
import { documents, documentVersions } from "./files";
import { users } from "./identity";
import { books } from "./publishing";

/* Section 12 "Files and personal library": saved items, collections, notes and progress. */

export const libraryItems = pgTable(
  "library_items",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    documentId: uuid("document_id").references(() => documents.id),
    bookId: uuid("book_id").references(() => books.id),
    ...timestamps(),
  },
  (t) => [
    check("library_items_one_target_check", sql`num_nonnulls(${t.documentId}, ${t.bookId}) = 1`),
    uniqueIndex("library_items_user_document_key")
      .on(t.userId, t.documentId)
      .where(sql`${t.documentId} is not null`),
    uniqueIndex("library_items_user_book_key")
      .on(t.userId, t.bookId)
      .where(sql`${t.bookId} is not null`),
    // My Library: recently added (Section 24).
    index("library_items_user_created_idx").on(
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("library_items_document_idx").on(t.documentId),
    index("library_items_book_idx").on(t.bookId),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps(),
  },
  // Names are unique per user (Section 28), case-insensitively.
  (t) => [uniqueIndex("collections_user_name_key").on(t.userId, sql`lower(${t.name})`)],
);

/** Both sides must belong to the same user; checked in `@foliomind/domain` access helpers. */
export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    libraryItemId: uuid("library_item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.libraryItemId] }),
    index("collection_items_library_item_idx").on(t.libraryItemId),
  ],
);

export const annotations = pgTable(
  "annotations",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    kind: annotationKind("kind").notNull(),
    pageNumber: integer("page_number").notNull(),
    anchor: jsonb("anchor").notNull(),
    body: text("body"),
    colorToken: text("color_token"),
    ...timestamps(),
  },
  (t) => [
    check("annotations_page_number_check", sql`${t.pageNumber} >= 1`),
    index("annotations_user_version_idx").on(t.userId, t.documentVersionId),
    index("annotations_version_idx").on(t.documentVersionId),
  ],
);

export const readingProgress = pgTable(
  "reading_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    position: jsonb("position").notNull().default({}),
    lastReadAt: timestamptz("last_read_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.documentVersionId] }),
    check("reading_progress_page_number_check", sql`${t.pageNumber} >= 1`),
    // Continue reading: most recent first.
    index("reading_progress_user_last_read_idx").on(t.userId, t.lastReadAt.desc().nullsFirst()),
    index("reading_progress_version_idx").on(t.documentVersionId),
  ],
);
