ALTER TABLE "message_citations" ADD COLUMN "support_status" text DEFAULT 'unchecked' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "focus" jsonb;--> statement-breakpoint
ALTER TABLE "message_citations" ADD CONSTRAINT "message_citations_support_status_check" CHECK ("message_citations"."support_status" in ('unchecked', 'supported', 'unsupported'));