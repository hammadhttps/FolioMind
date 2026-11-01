import { pgEnum } from "drizzle-orm/pg-core";

/*
 * PostgreSQL enums for the fixed value sets in blueprint Section 12. Status
 * columns the blueprint leaves as `text` stay text; the phase that defines their
 * values adds a check constraint.
 */

export const userRole = pgEnum("user_role", ["reader", "publisher", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended", "deleting"]);
export const identityProvider = pgEnum("identity_provider", ["auth0", "google-oauth2", "github"]);
export const themePreference = pgEnum("theme_preference", ["system", "light", "dark"]);

export const publisherStatus = pgEnum("publisher_status", [
  "applicant",
  "approved",
  "rejected",
  "suspended",
]);
export const bookStatus = pgEnum("book_status", [
  "draft",
  "pending",
  "published",
  "unpublished",
  "removed",
]);
export const bookRevisionStatus = pgEnum("book_revision_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
]);
export const reportStatus = pgEnum("report_status", ["open", "resolved", "dismissed"]);

export const assetAcl = pgEnum("asset_acl", ["public", "private"]);
export const assetPurpose = pgEnum("asset_purpose", ["source", "export", "cover", "avatar"]);
export const assetState = pgEnum("asset_state", ["pending", "ready", "deleting", "deleted"]);
export const uploadIntentStatus = pgEnum("upload_intent_status", [
  "issued",
  "completed",
  "expired",
]);
export const documentSourceKind = pgEnum("document_source_kind", ["upload", "url_import"]);
export const documentStatus = pgEnum("document_status", ["active", "deleting", "deleted"]);
export const urlImportStatus = pgEnum("url_import_status", [
  "queued",
  "fetching",
  "rendering",
  "ingesting",
  "ready",
  "failed",
]);
export const documentVersionStatus = pgEnum("document_version_status", [
  "uploaded",
  "queued",
  "extracting",
  "embedding",
  "ready",
  "failed",
  "needs_ocr",
]);
export const annotationKind = pgEnum("annotation_kind", ["bookmark", "highlight", "note"]);

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const projectMode = pgEnum("project_mode", ["research", "general"]);

export const usageOperationStatus = pgEnum("usage_operation_status", [
  "reserved",
  "committed",
  "released",
]);

/** Job statuses from Section 9 (`jobs.status` is checked text). */
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

/** Stripe subscription statuses (`subscriptions.status` is checked text). */
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

/** Statuses after which a subscription can never become active again. */
export const TERMINAL_SUBSCRIPTION_STATUSES = ["canceled", "incomplete_expired"] as const;
