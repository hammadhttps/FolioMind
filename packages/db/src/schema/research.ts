import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, inValues, timestamps } from "./columns";
import { messageRole } from "./enums";
import { documentChunks, documentVersions } from "./files";
import { users } from "./identity";
import { aiRuns } from "./operations";

/* Section 12 "Research and generated content": workspaces and cited conversations. */

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps(),
  },
  // Dashboard research tab: recently updated (Section 24).
  (t) => [
    index("workspaces_owner_updated_idx").on(
      t.ownerId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);

/** Permission is checked when a source is added and again on each use. */
export const workspaceSources = pgTable(
  "workspace_sources",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.documentVersionId] }),
    check("workspace_sources_position_check", sql`${t.position} >= 0`),
    index("workspace_sources_version_idx").on(t.documentVersionId),
  ],
);

export const workspaceNotes = pgTable(
  "workspace_notes",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: jsonb("body").notNull(),
    sourceMessageId: uuid("source_message_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    citationRefs: jsonb("citation_refs").notNull().default([]),
    ...timestamps(),
  },
  (t) => [
    index("workspace_notes_workspace_idx").on(
      t.workspaceId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id").references(() => documentVersions.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    ...timestamps(),
  },
  (t) => [
    check(
      "conversations_one_scope_check",
      sql`num_nonnulls(${t.workspaceId}, ${t.documentVersionId}) = 1`,
    ),
    // Chat history: recently updated (Section 24).
    index("conversations_user_updated_idx").on(
      t.userId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("conversations_workspace_idx").on(t.workspaceId),
    index("conversations_version_idx").on(t.documentVersionId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references((): AnyPgColumn => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull(),
    /** "Ask about selection": the selected text and its page, on the user's message. */
    focus: jsonb("focus"),
    aiRunId: uuid("ai_run_id").references((): AnyPgColumn => aiRuns.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt, t.id)],
);

/** Page and label tombstones survive source deletion; excerpts and chunks do not. */
export const messageCitations = pgTable(
  "message_citations",
  {
    id: id(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => documentChunks.id, { onDelete: "set null" }),
    sourceVersionId: uuid("source_version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    citationLabel: text("citation_label").notNull(),
    sourceAvailable: boolean("source_available").notNull().default(true),
    /** Section 8 step 6: a valid ID alone is not proof, so each citation is checked against its passage. */
    supportStatus: text("support_status").notNull().default("unchecked"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "message_citations_pages_check",
      sql`${t.pageStart} >= 1 and ${t.pageEnd} >= ${t.pageStart}`,
    ),
    check(
      "message_citations_support_status_check",
      inValues(t.supportStatus, ["unchecked", "supported", "unsupported"]),
    ),
    index("message_citations_message_idx").on(t.messageId),
    index("message_citations_chunk_idx").on(t.chunkId),
    index("message_citations_source_version_idx").on(t.sourceVersionId),
  ],
);
