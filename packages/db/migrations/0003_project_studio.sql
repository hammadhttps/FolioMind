ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "section_proposals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "credit_operation_key" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "first_draft_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_status_check" CHECK ("exports"."status" in ('queued', 'rendering', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('draft', 'outline', 'drafting', 'editing', 'rendering', 'complete', 'failed'));