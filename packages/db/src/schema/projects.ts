import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, timestamptz } from "./columns";
import { projectMode } from "./enums";
import { assets, documentVersions } from "./files";
import { users } from "./identity";
import { jobs } from "./operations";
import { workspaces } from "./research";

/* Section 12 "Research and generated content": projects, revisions and exports. */

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    mode: projectMode("mode").notNull(),
    prompt: text("prompt").notNull(),
    settings: jsonb("settings").notNull().default({}),
    templateKey: text("template_key").notNull(),
    outline: jsonb("outline").notNull().default([]),
    editorContent: jsonb("editor_content").notNull().default({}),
    /** Optimistic concurrency for editor saves (Section 11). */
    revisionCounter: integer("revision_counter").notNull().default(0),
    status: text("status").notNull(),
    archivedAt: timestamptz("archived_at"),
    ...timestamps(),
  },
  (t) => [
    check("projects_revision_counter_check", sql`${t.revisionCounter} >= 0`),
    // My Projects: recently updated (Section 24).
    index("projects_owner_updated_idx").on(
      t.ownerId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("projects_workspace_idx").on(t.workspaceId),
    index("projects_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
  ],
);

/** Immutable source versions selected for the project. */
export const projectSources = pgTable(
  "project_sources",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.documentVersionId] }),
    index("project_sources_version_idx").on(t.documentVersionId),
  ],
);

export const projectRevisions = pgTable(
  "project_revisions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revisionNo: integer("revision_no").notNull(),
    content: jsonb("content").notNull(),
    outline: jsonb("outline").notNull(),
    citations: jsonb("citations").notNull(),
    sourceSnapshot: jsonb("source_snapshot").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_revisions_project_revision_no_key").on(t.projectId, t.revisionNo),
    check("project_revisions_revision_no_check", sql`${t.revisionNo} >= 1`),
  ],
);

export const exports = pgTable(
  "exports",
  {
    id: id(),
    projectRevisionId: uuid("project_revision_id")
      .notNull()
      .references(() => projectRevisions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    templateVersion: text("template_version").notNull(),
    pageCount: integer("page_count"),
    status: text("status").notNull(),
    operationKey: text("operation_key").notNull().unique(),
    ...timestamps(),
  },
  (t) => [
    check("exports_page_count_check", sql`${t.pageCount} >= 0`),
    index("exports_revision_idx").on(t.projectRevisionId),
    index("exports_job_idx").on(t.jobId),
  ],
);
