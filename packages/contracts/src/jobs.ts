import { z } from "zod";

/*
 * Application jobs (blueprint Sections 9 and 11): what users and admins see
 * about a long operation. Inngest keeps run and step state; `jobs` keeps the
 * status, phase, progress and a safe error code.
 */

export const DOCUMENT_JOB_KINDS = ["ingest-document", "import-url"] as const;
/** Worker B (Section 9): one live job per project at a time. */
export const PROJECT_JOB_KINDS = [
  "generate-outline",
  "generate-draft",
  "regenerate-section",
  "render-export",
] as const;
export type ProjectJobKind = (typeof PROJECT_JOB_KINDS)[number];
export const JOB_KINDS = [...DOCUMENT_JOB_KINDS, ...PROJECT_JOB_KINDS] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUS_VALUES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUS_VALUES)[number];
export const TERMINAL_JOB_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export function isTerminalJobStatus(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

/** Phases in run order; the library shows the matching progress text. */
export const JOB_PHASES = [
  "queued",
  "fetching",
  "rendering",
  "saving",
  "validating",
  "extracting",
  "chunking",
  "embedding",
  "verifying",
  "retrieving",
  "outlining",
  "drafting",
  "revising",
  "composing",
  "exporting",
  "uploading",
  "done",
] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

export const JOB_PHASE_LABELS: Record<JobPhase, string> = {
  queued: "Waiting to start…",
  fetching: "Fetching the article…",
  rendering: "Making a PDF snapshot…",
  saving: "Saving the snapshot…",
  validating: "Checking the file…",
  extracting: "Reading the pages…",
  chunking: "Organizing the text…",
  embedding: "Indexing for search…",
  verifying: "Finishing up…",
  retrieving: "Finding evidence in your sources…",
  outlining: "Writing an outline…",
  drafting: "Writing each section…",
  revising: "Writing a new version…",
  composing: "Laying out your document…",
  exporting: "Rendering your PDF…",
  uploading: "Saving your PDF…",
  done: "Done",
};

/**
 * Error codes safe to show the owner (never provider messages or stack
 * traces), with the Section 20-style explanation.
 */
export const JOB_ERROR_MESSAGES = {
  invalid_pdf: "This file isn't a readable PDF.",
  encrypted_pdf: "This PDF is password protected. Remove the password and upload it again.",
  too_many_pages: "PDFs can have up to 150 pages.",
  file_too_large: "PDFs can be up to 20 MB.",
  needs_ocr:
    "This PDF looks scanned or has no selectable text. FolioMind can't read scanned pages yet, so it can't be searched or used for answers.",
  extraction_timeout: "This PDF took too long to read. Try a smaller or simpler file.",
  file_missing: "We couldn't find the stored file. Upload it again.",
  provider_unavailable: "A service we rely on was unavailable. Try again in a few minutes.",
  cancelled: "Processing was cancelled.",
  unsupported_page:
    "That page didn't have enough readable article text. Sign-in pages, paywalls and very short pages can't be imported.",
  page_too_long: "That article is too long to import.",
  import_failed: "We couldn't import that page. Check the address and try again.",
  render_failed: "We couldn't make a PDF of that page. Try again later.",
  storage_limit:
    "This would go over your storage allowance. Delete something or upgrade, then try again.",
  generation_failed: "We couldn't finish this. Nothing was charged. Please try again.",
  provider_daily_limit:
    "FolioMind has used today's free AI requests. Nothing was charged. Please try again tomorrow.",
  source_unavailable:
    "A source in this project isn't available anymore. Remove it or pick another, then try again.",
  export_too_large: "This document is too long to export. PDFs can have up to 200 pages.",
  export_failed: "We couldn't render this PDF. Nothing was charged. Please try again.",
  internal: "Something went wrong while processing it. Try again.",
} as const;
export type JobErrorCode = keyof typeof JOB_ERROR_MESSAGES;
export const jobErrorCodeSchema = z.enum(
  Object.keys(JOB_ERROR_MESSAGES) as [JobErrorCode, ...JobErrorCode[]],
);

/** Errors a retry can't fix: the library offers no Retry for these. */
export const PERMANENT_JOB_ERRORS = [
  "invalid_pdf",
  "encrypted_pdf",
  "too_many_pages",
  "file_too_large",
  "needs_ocr",
  "file_missing",
  "export_too_large",
] as const satisfies readonly JobErrorCode[];

export function jobErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return (JOB_ERROR_MESSAGES as Record<string, string>)[code] ?? JOB_ERROR_MESSAGES.internal;
}

/** Progress counters kept small (Section 9: small step outputs and job rows). */
export const jobProgressSchema = z
  .object({
    pages: z.number().int().nonnegative().optional(),
    chunks: z.number().int().nonnegative().optional(),
    embedded: z.number().int().nonnegative().optional(),
    sections: z.number().int().nonnegative().optional(),
    sectionsDone: z.number().int().nonnegative().optional(),
  })
  .partial();
export type JobProgress = z.infer<typeof jobProgressSchema>;

/** `GET /api/jobs/:id`: owner-safe status only. */
export const jobStatusResponseSchema = z.object({
  id: z.uuid(),
  kind: z.enum(JOB_KINDS),
  status: z.enum(JOB_STATUS_VALUES),
  phase: z.enum(JOB_PHASES),
  phaseLabel: z.string(),
  progress: jobProgressSchema,
  errorCode: jobErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  canRetry: z.boolean(),
  canCancel: z.boolean(),
  documentId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
});
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

/** Extraction limits (Section 8): application defaults, tuned to provider plans. */
export const MAX_SOURCE_PAGES = 150;
