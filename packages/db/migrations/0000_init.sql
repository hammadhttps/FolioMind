-- Hand-added (blueprint Section 12): pgvector for document_chunks.embedding and
-- pg_trgm for typo-tolerant title search. Drizzle cannot declare extensions.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."annotation_kind" AS ENUM('bookmark', 'highlight', 'note');--> statement-breakpoint
CREATE TYPE "public"."asset_acl" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."asset_purpose" AS ENUM('source', 'export', 'cover', 'avatar');--> statement-breakpoint
CREATE TYPE "public"."asset_state" AS ENUM('pending', 'ready', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."book_revision_status" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."book_status" AS ENUM('draft', 'pending', 'published', 'unpublished', 'removed');--> statement-breakpoint
CREATE TYPE "public"."document_source_kind" AS ENUM('upload', 'url_import');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('active', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."document_version_status" AS ENUM('uploaded', 'queued', 'extracting', 'embedding', 'ready', 'failed', 'needs_ocr');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('auth0', 'google-oauth2', 'github');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."project_mode" AS ENUM('research', 'general');--> statement-breakpoint
CREATE TYPE "public"."publisher_status" AS ENUM('applicant', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."theme_preference" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."upload_intent_status" AS ENUM('issued', 'completed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."url_import_status" AS ENUM('queued', 'fetching', 'rendering', 'ingesting', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."usage_operation_status" AS ENUM('reserved', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('reader', 'publisher', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleting');--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_user_key" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" "theme_preference" DEFAULT 'light' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"notification_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth0_sub" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"avatar_asset_id" uuid,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'reader' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth0_sub_unique" UNIQUE("auth0_sub")
);
--> statement-breakpoint
CREATE TABLE "book_revision_categories" (
	"book_revision_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "book_revision_categories_book_revision_id_category_id_pk" PRIMARY KEY("book_revision_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "book_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"document_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"author" text NOT NULL,
	"language" text NOT NULL,
	"cover_asset_id" uuid,
	"license_statement" text NOT NULL,
	"status" "book_revision_status" DEFAULT 'draft' NOT NULL,
	"reviewed_by" uuid,
	"review_reason" text,
	"published_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce("book_revisions"."title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("book_revisions"."author", '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce("book_revisions"."description", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_revisions_book_revision_no_key" UNIQUE("book_id","revision_no"),
	CONSTRAINT "book_revisions_book_id_id_key" UNIQUE("book_id","id"),
	CONSTRAINT "book_revisions_revision_no_check" CHECK ("book_revisions"."revision_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"status" "book_status" DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publisher_follows" (
	"user_id" uuid NOT NULL,
	"publisher_id" uuid NOT NULL,
	"notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publisher_follows_user_id_publisher_id_pk" PRIMARY KEY("user_id","publisher_id")
);
--> statement-breakpoint
CREATE TABLE "publisher_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text NOT NULL,
	"website" text,
	"status" "publisher_status" DEFAULT 'applicant' NOT NULL,
	"application_note" text,
	"reviewed_by" uuid,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publisher_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "publisher_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"custom_id" text NOT NULL,
	"file_route" text NOT NULL,
	"acl" "asset_acl" NOT NULL,
	"purpose" "asset_purpose" NOT NULL,
	"bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"checksum" text,
	"state" "asset_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_file_key_unique" UNIQUE("file_key"),
	CONSTRAINT "assets_custom_id_unique" UNIQUE("custom_id"),
	CONSTRAINT "assets_bytes_check" CHECK ("assets"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"heading" text,
	"text" text NOT NULL,
	"char_offsets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1024),
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce("document_chunks"."heading", '')), 'A') || setweight(to_tsvector('english'::regconfig, "document_chunks"."text"), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_version_chunk_key" UNIQUE("document_version_id","chunk_index"),
	CONSTRAINT "document_chunks_chunk_index_check" CHECK ("document_chunks"."chunk_index" >= 0),
	CONSTRAINT "document_chunks_pages_check" CHECK ("document_chunks"."page_start" >= 1 and "document_chunks"."page_end" >= "document_chunks"."page_start"),
	CONSTRAINT "document_chunks_token_count_check" CHECK ("document_chunks"."token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"document_version_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"page_label" text,
	"text" text NOT NULL,
	"extraction_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_pages_document_version_id_page_number_pk" PRIMARY KEY("document_version_id","page_number"),
	CONSTRAINT "document_pages_page_number_check" CHECK ("document_pages"."page_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"asset_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"language" text,
	"status" "document_version_status" DEFAULT 'uploaded' NOT NULL,
	"index_version" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimension" integer NOT NULL,
	"extraction_quality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_version_no_key" UNIQUE("document_id","version_no"),
	CONSTRAINT "document_versions_document_id_id_key" UNIQUE("document_id","id"),
	CONSTRAINT "document_versions_version_no_check" CHECK ("document_versions"."version_no" >= 1),
	CONSTRAINT "document_versions_page_count_check" CHECK ("document_versions"."page_count" >= 0),
	CONSTRAINT "document_versions_embedding_dimension_check" CHECK ("document_versions"."embedding_dimension" > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_kind" "document_source_kind" NOT NULL,
	"source_url" text,
	"current_version_id" uuid,
	"status" "document_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_route" text NOT NULL,
	"custom_id" text NOT NULL,
	"max_bytes" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "upload_intent_status" DEFAULT 'issued' NOT NULL,
	"asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_intents_custom_id_unique" UNIQUE("custom_id"),
	CONSTRAINT "upload_intents_max_bytes_check" CHECK ("upload_intents"."max_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "url_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"url_hash" text NOT NULL,
	"rights_confirmed_at" timestamp with time zone NOT NULL,
	"status" "url_import_status" DEFAULT 'queued' NOT NULL,
	"fetched_title" text,
	"word_count" integer,
	"document_id" uuid,
	"job_id" uuid,
	"safe_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "url_imports_word_count_check" CHECK ("url_imports"."word_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"kind" "annotation_kind" NOT NULL,
	"page_number" integer NOT NULL,
	"anchor" jsonb NOT NULL,
	"body" text,
	"color_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotations_page_number_check" CHECK ("annotations"."page_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"collection_id" uuid NOT NULL,
	"library_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_collection_id_library_item_id_pk" PRIMARY KEY("collection_id","library_item_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid,
	"book_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_one_target_check" CHECK (num_nonnulls("library_items"."document_id", "library_items"."book_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"user_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"position" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_user_id_document_version_id_pk" PRIMARY KEY("user_id","document_version_id"),
	CONSTRAINT "reading_progress_page_number_check" CHECK ("reading_progress"."page_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"document_version_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_one_scope_check" CHECK (num_nonnulls("conversations"."workspace_id", "conversations"."document_version_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "message_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"chunk_id" uuid,
	"source_version_id" uuid,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"citation_label" text NOT NULL,
	"source_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_citations_pages_check" CHECK ("message_citations"."page_start" >= 1 and "message_citations"."page_end" >= "message_citations"."page_start")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"source_message_id" uuid,
	"citation_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_sources" (
	"workspace_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_sources_workspace_id_document_version_id_pk" PRIMARY KEY("workspace_id","document_version_id"),
	CONSTRAINT "workspace_sources_position_check" CHECK ("workspace_sources"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_revision_id" uuid NOT NULL,
	"asset_id" uuid,
	"job_id" uuid NOT NULL,
	"template_version" text NOT NULL,
	"page_count" integer,
	"status" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "exports_page_count_check" CHECK ("exports"."page_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"outline" jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_revisions_project_revision_no_key" UNIQUE("project_id","revision_no"),
	CONSTRAINT "project_revisions_revision_no_check" CHECK ("project_revisions"."revision_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_sources" (
	"project_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sources_project_id_document_version_id_pk" PRIMARY KEY("project_id","document_version_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"mode" "project_mode" NOT NULL,
	"prompt" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_key" text NOT NULL,
	"outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editor_content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision_counter" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_revision_counter_check" CHECK ("projects"."revision_counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_session_id" text,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_attempts_stripe_session_id_unique" UNIQUE("stripe_session_id"),
	CONSTRAINT "billing_checkout_attempts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"stripe_invoice_id" text PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount_paid" bigint NOT NULL,
	"currency" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"hosted_invoice_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_amount_paid_check" CHECK ("billing_invoices"."amount_paid" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"stripe_price_id" text,
	"limits" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_stripe_price_id_unique" UNIQUE("stripe_price_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"status" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_through" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "usage_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"limit" bigint NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"consumed" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_buckets_user_metric_period_key" UNIQUE("user_id","metric","period_start"),
	CONSTRAINT "usage_buckets_limit_check" CHECK ("usage_buckets"."limit" >= 0),
	CONSTRAINT "usage_buckets_reserved_check" CHECK ("usage_buckets"."reserved" >= 0),
	CONSTRAINT "usage_buckets_consumed_check" CHECK ("usage_buckets"."consumed" >= 0),
	CONSTRAINT "usage_buckets_period_check" CHECK ("usage_buckets"."period_end" > "usage_buckets"."period_start")
);
--> statement-breakpoint
CREATE TABLE "usage_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"quantity" bigint NOT NULL,
	"status" "usage_operation_status" DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_operations_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "usage_operations_quantity_check" CHECK ("usage_operations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"object_id" text,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	CONSTRAINT "webhook_events_attempts_check" CHECK ("webhook_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"estimated_cost" numeric,
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"retrieval_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_counts_check" CHECK ("ai_runs"."input_tokens" >= 0 and "ai_runs"."output_tokens" >= 0 and "ai_runs"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"book_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reads" bigint DEFAULT 0 NOT NULL,
	"saves" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_book_id_date_pk" PRIMARY KEY("book_id","date"),
	CONSTRAINT "analytics_daily_counts_check" CHECK ("analytics_daily"."reads" >= 0 and "analytics_daily"."saves" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"kind" text NOT NULL,
	"target_id" uuid,
	"operation_key" text NOT NULL,
	"inngest_event_id" text,
	"inngest_run_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"phase" text DEFAULT 'queued' NOT NULL,
	"progress" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"safe_error_code" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"notification_id" uuid NOT NULL,
	"push_device_id" uuid NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_notification_id_push_device_id_pk" PRIMARY KEY("notification_id","push_device_id"),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"safe_body" text NOT NULL,
	"target_path" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_event_key" UNIQUE("user_id","event_key")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_subscriber_id" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_provider_subscriber_id_unique" UNIQUE("provider_subscriber_id")
);
--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_asset_id_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revision_categories" ADD CONSTRAINT "book_revision_categories_book_revision_id_book_revisions_id_fk" FOREIGN KEY ("book_revision_id") REFERENCES "public"."book_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revision_categories" ADD CONSTRAINT "book_revision_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_publisher_id_publisher_profiles_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publisher_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_published_revision_fk" FOREIGN KEY ("id","published_revision_id") REFERENCES "public"."book_revisions"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_follows" ADD CONSTRAINT "publisher_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_follows" ADD CONSTRAINT "publisher_follows_publisher_id_publisher_profiles_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publisher_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_profiles" ADD CONSTRAINT "publisher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_profiles" ADD CONSTRAINT "publisher_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_fk" FOREIGN KEY ("id","current_version_id") REFERENCES "public"."document_versions"("document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_imports" ADD CONSTRAINT "url_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_imports" ADD CONSTRAINT "url_imports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_imports" ADD CONSTRAINT "url_imports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_library_item_id_library_items_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_source_version_id_document_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notes" ADD CONSTRAINT "workspace_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notes" ADD CONSTRAINT "workspace_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notes" ADD CONSTRAINT "workspace_notes_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sources" ADD CONSTRAINT "workspace_sources_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_project_revision_id_project_revisions_id_fk" FOREIGN KEY ("project_revision_id") REFERENCES "public"."project_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_operations" ADD CONSTRAINT "usage_operations_bucket_id_usage_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."usage_buckets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_operations" ADD CONSTRAINT "usage_operations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_push_device_id_push_devices_id_fk" FOREIGN KEY ("push_device_id") REFERENCES "public"."push_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "book_revision_categories_category_idx" ON "book_revision_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "book_revisions_document_version_idx" ON "book_revisions" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "book_revisions_published_idx" ON "book_revisions" USING btree ("published_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "book_revisions"."published_at" is not null;--> statement-breakpoint
CREATE INDEX "book_revisions_status_idx" ON "book_revisions" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "book_revisions_search_idx" ON "book_revisions" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "book_revisions_title_trgm_idx" ON "book_revisions" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "book_revisions_author_trgm_idx" ON "book_revisions" USING gin ("author" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "books_publisher_updated_idx" ON "books" USING btree ("publisher_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "books_published_revision_idx" ON "books" USING btree ("published_revision_id");--> statement-breakpoint
CREATE INDEX "content_reports_status_idx" ON "content_reports" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "content_reports_book_idx" ON "content_reports" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "content_reports_reporter_idx" ON "content_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "publisher_follows_publisher_idx" ON "publisher_follows" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "publisher_profiles_status_idx" ON "publisher_profiles" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "assets_owner_state_idx" ON "assets" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "document_chunks_search_idx" ON "document_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_versions_asset_idx" ON "document_versions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "document_versions_status_idx" ON "document_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_owner_updated_idx" ON "documents" USING btree ("owner_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "documents_title_trgm_idx" ON "documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "upload_intents_user_idx" ON "upload_intents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_intents_status_expires_idx" ON "upload_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "url_imports_user_created_idx" ON "url_imports" USING btree ("user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "url_imports_url_hash_idx" ON "url_imports" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "annotations_user_version_idx" ON "annotations" USING btree ("user_id","document_version_id");--> statement-breakpoint
CREATE INDEX "annotations_version_idx" ON "annotations" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "collection_items_library_item_idx" ON "collection_items" USING btree ("library_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_key" ON "collections" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "library_items_user_document_key" ON "library_items" USING btree ("user_id","document_id") WHERE "library_items"."document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "library_items_user_book_key" ON "library_items" USING btree ("user_id","book_id") WHERE "library_items"."book_id" is not null;--> statement-breakpoint
CREATE INDEX "library_items_user_created_idx" ON "library_items" USING btree ("user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "library_items_document_idx" ON "library_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "library_items_book_idx" ON "library_items" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_last_read_idx" ON "reading_progress" USING btree ("user_id","last_read_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "reading_progress_version_idx" ON "reading_progress" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "conversations_workspace_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conversations_version_idx" ON "conversations" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "message_citations_message_idx" ON "message_citations" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_citations_chunk_idx" ON "message_citations" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "message_citations_source_version_idx" ON "message_citations" USING btree ("source_version_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workspace_notes_workspace_idx" ON "workspace_notes" USING btree ("workspace_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workspace_sources_version_idx" ON "workspace_sources" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_updated_idx" ON "workspaces" USING btree ("owner_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "exports_revision_idx" ON "exports" USING btree ("project_revision_id");--> statement-breakpoint
CREATE INDEX "exports_job_idx" ON "exports" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "project_sources_version_idx" ON "project_sources" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "projects_owner_updated_idx" ON "projects" USING btree ("owner_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_title_trgm_idx" ON "projects" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "billing_checkout_attempts_user_idx" ON "billing_checkout_attempts" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "billing_invoices_subscription_idx" ON "billing_invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_nonterminal_key" ON "subscriptions" USING btree ("user_id") WHERE not ("subscriptions"."status" in ('canceled', 'incomplete_expired'));--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_operations_bucket_idx" ON "usage_operations" USING btree ("bucket_id");--> statement-breakpoint
CREATE INDEX "usage_operations_reserved_expiry_idx" ON "usage_operations" USING btree ("expires_at") WHERE "usage_operations"."status" = 'reserved';--> statement-breakpoint
CREATE INDEX "webhook_events_status_received_idx" ON "webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "ai_runs_user_created_idx" ON "ai_runs" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ai_runs_job_idx" ON "ai_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "jobs_owner_created_idx" ON "jobs" USING btree ("owner_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "jobs_kind_target_idx" ON "jobs" USING btree ("kind","target_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_device_idx" ON "notification_deliveries" USING btree ("push_device_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."delivered_at" is null;--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");