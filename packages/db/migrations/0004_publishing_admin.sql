ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "details" text;--> statement-breakpoint
CREATE UNIQUE INDEX "book_revisions_one_open_key" ON "book_revisions" USING btree ("book_id") WHERE "book_revisions"."status" in ('draft', 'pending');--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_open_reporter_key" ON "content_reports" USING btree ("reporter_id","book_id") WHERE "content_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reason_check" CHECK ("content_reports"."reason" in ('copyright', 'inappropriate', 'incorrect_metadata', 'other'));--> statement-breakpoint
ALTER TABLE "publisher_profiles" ADD CONSTRAINT "publisher_profiles_slug_check" CHECK ("publisher_profiles"."slug" ~ '^[a-z0-9-]{3,40}$');