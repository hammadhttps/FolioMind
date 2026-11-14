import { z } from "zod";

/*
 * Admin Overview and Content Moderation (blueprint Sections 4, 5 rows 15–16,
 * 24 and 28). Every admin mutation is audited; none of these views shows
 * prompts, document text or private uploads.
 */

export const ADMIN_TABS = ["health", "users", "applications", "usage", "audit"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Section 24 page sizes. */
export const ADMIN_PAGE_SIZE = 25;
export const AUDIT_PAGE_SIZE = 50;
export const MODERATION_PAGE_SIZE = 25;

/** Where operators look at runs and steps; FolioMind keeps only user-visible job state. */
export const INNGEST_DASHBOARD_URL = "https://app.inngest.com";

/** Section 28 "Suspend user": reason of 10–500 characters, optional end date. */
export const SUSPENSION_MAX_DAYS = 365;

export const suspendUserSchema = z.object({
  userId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(10, "Write at least 10 characters.")
    .max(500, "Use 500 characters or fewer."),
  /** A calendar date (UTC); the suspension lifts at the start of that day. */
  endsOn: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.iso.date({ error: "Choose a valid date." }).optional()),
});
export type SuspendUserInput = z.input<typeof suspendUserSchema>;

export const unsuspendUserSchema = z.object({
  userId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(500, "Use 500 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type UnsuspendUserInput = z.input<typeof unsuspendUserSchema>;

export const retryJobSchema = z.object({ jobId: z.uuid() });

/** Job kinds an admin can retry here; the owner retries generation from PDF Studio. */
export const ADMIN_RETRYABLE_JOB_KINDS = [
  "ingest-document",
  "import-url",
  "render-export",
] as const;

export const ADMIN_REFUSALS = {
  not_found: "That record isn't available anymore.",
  self: "You can't change your own account here.",
  admin_target: "Administrator accounts are managed through the audited admin process.",
  not_suspended: "This account isn't suspended.",
  already_suspended: "This account is already suspended.",
  deleting: "This account is being deleted.",
  end_in_past: "Choose an end date after today.",
  end_too_far: `Suspensions can last up to ${SUSPENSION_MAX_DAYS} days. Leave the date empty for no end date.`,
  not_retryable:
    "This job can't be retried. Its owner can try again from their library or project.",
  quota: "The owner has used their allowance for this, so it can't be retried now.",
  busy: "Something is already running for this item.",
} as const;
export type AdminRefusalCode = keyof typeof ADMIN_REFUSALS;

/** Audit actions an admin can filter on (also the writer's allowed list in the domain). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "user.role_granted": "Role granted",
  "user.signin_refused": "Sign-in refused",
  "user.suspended": "User suspended",
  "user.unsuspended": "User unsuspended",
  "identity.linked": "Sign-in method connected",
  "identity.unlinked": "Sign-in method disconnected",
  "identity.link_refused": "Connection refused",
  "publisher.applied": "Publisher applied",
  "publisher.approved": "Publisher approved",
  "publisher.rejected": "Publisher rejected",
  "publisher.profile_updated": "Publisher profile updated",
  "book.created": "Book draft created",
  "book.submitted": "Book submitted",
  "book.withdrawn": "Submission withdrawn",
  "book.unpublished": "Book unpublished",
  "book.approved": "Book approved",
  "book.rejected": "Book rejected",
  "book.taken_down": "Book taken down",
  "book.deleted": "Book draft deleted",
  "report.created": "Report filed",
  "report.resolved": "Report resolved",
  "report.dismissed": "Report dismissed",
  "job.retried": "Job retried",
};
