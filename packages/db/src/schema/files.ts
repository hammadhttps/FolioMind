import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { INDEX_EMBEDDING_DIMENSION } from "@foliomind/contracts";
import { createdAt, id, timestamps, timestamptz, tsvector } from "./columns";
import {
  assetAcl,
  assetPurpose,
  assetState,
  documentSourceKind,
  documentStatus,
  documentVersionStatus,
  uploadIntentStatus,
  urlImportStatus,
} from "./enums";
import { users } from "./identity";
import { jobs } from "./operations";

/* Section 12 "Files and personal library": stored files, documents and their index. */

export const assets = pgTable(
  "assets",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    /** UploadThing file key. */
    fileKey: text("file_key").notNull().unique(),
    /** Upload intent or operation key, sent to UploadThing as the file's customId. */
    customId: text("custom_id").notNull().unique(),
    fileRoute: text("file_route").notNull(),
    acl: assetAcl("acl").notNull(),
    purpose: assetPurpose("purpose").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum"),
    state: assetState("state").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [
    check("assets_bytes_check", sql`${t.bytes} >= 0`),
    // Storage gauge: sum of a user's live assets (Section 10).
    index("assets_owner_state_idx").on(t.ownerId, t.state),
  ],
);

export const uploadIntents = pgTable(
  "upload_intents",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    fileRoute: text("file_route").notNull(),
    customId: text("custom_id").notNull().unique(),
    maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    status: uploadIntentStatus("status").notNull().default("issued"),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    check("upload_intents_max_bytes_check", sql`${t.maxBytes} > 0`),
    index("upload_intents_user_idx").on(t.userId),
    // Cleanup of expired intents.
    index("upload_intents_status_expires_idx").on(t.status, t.expiresAt),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    sourceKind: documentSourceKind("source_kind").notNull(),
    sourceUrl: text("source_url"),
    /** Set after the first version exists; must be a version of this document (composite FK below). */
    currentVersionId: uuid("current_version_id"),
    status: documentStatus("status").notNull().default("active"),
    deletedAt: timestamptz("deleted_at"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "documents_current_version_fk",
      columns: [t.id, t.currentVersionId],
      foreignColumns: [documentVersions.documentId, documentVersions.id],
    }),
    index("documents_owner_updated_idx").on(
      t.ownerId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("documents_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
  ],
);

export const urlImports = pgTable(
  "url_imports",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sourceUrl: text("source_url").notNull(),
    urlHash: text("url_hash").notNull(),
    rightsConfirmedAt: timestamptz("rights_confirmed_at").notNull(),
    status: urlImportStatus("status").notNull().default("queued"),
    fetchedTitle: text("fetched_title"),
    wordCount: integer("word_count"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references((): AnyPgColumn => jobs.id, { onDelete: "set null" }),
    safeErrorCode: text("safe_error_code"),
    ...timestamps(),
  },
  (t) => [
    check("url_imports_word_count_check", sql`${t.wordCount} >= 0`),
    index("url_imports_user_created_idx").on(
      t.userId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("url_imports_url_hash_idx").on(t.urlHash),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references((): AnyPgColumn => documents.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    sha256: text("sha256").notNull(),
    pageCount: integer("page_count"),
    language: text("language"),
    status: documentVersionStatus("status").notNull().default("uploaded"),
    indexVersion: text("index_version").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimension: integer("embedding_dimension").notNull(),
    extractionQuality: jsonb("extraction_quality").notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique("document_versions_document_version_no_key").on(t.documentId, t.versionNo),
    // Target of documents_current_version_fk.
    unique("document_versions_document_id_id_key").on(t.documentId, t.id),
    check("document_versions_version_no_check", sql`${t.versionNo} >= 1`),
    check("document_versions_page_count_check", sql`${t.pageCount} >= 0`),
    check("document_versions_embedding_dimension_check", sql`${t.embeddingDimension} > 0`),
    index("document_versions_asset_idx").on(t.assetId),
    index("document_versions_status_idx").on(t.status),
  ],
);

/** Physical page numbers start at 1. */
export const documentPages = pgTable(
  "document_pages",
  {
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    pageLabel: text("page_label"),
    text: text("text").notNull(),
    extractionMetadata: jsonb("extraction_metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.documentVersionId, t.pageNumber] }),
    check("document_pages_page_number_check", sql`${t.pageNumber} >= 1`),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: id(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    heading: text("heading"),
    text: text("text").notNull(),
    charOffsets: jsonb("char_offsets").notNull().default({}),
    tokenCount: integer("token_count").notNull(),
    contentHash: text("content_hash").notNull(),
    /** Filled by the embedding steps after the chunk rows exist (Section 9). */
    embedding: vector("embedding", { dimensions: INDEX_EMBEDDING_DIMENSION }),
    /** Heading (A) and chunk text (B). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english'::regconfig, coalesce(${documentChunks.heading}, '')), 'A') || setweight(to_tsvector('english'::regconfig, ${documentChunks.text}), 'B')`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_chunks_version_chunk_key").on(t.documentVersionId, t.chunkIndex),
    check("document_chunks_chunk_index_check", sql`${t.chunkIndex} >= 0`),
    check(
      "document_chunks_pages_check",
      sql`${t.pageStart} >= 1 and ${t.pageEnd} >= ${t.pageStart}`,
    ),
    check("document_chunks_token_count_check", sql`${t.tokenCount} >= 0`),
    index("document_chunks_embedding_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
    index("document_chunks_search_idx").using("gin", t.searchVector),
  ],
);
