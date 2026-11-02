import { z } from "zod";
import type { PlanCode } from "./plans";

/*
 * Private documents, collections and the Reader (blueprint Sections 8, 10, 25
 * and 28). Limits here are application defaults shared by the upload route,
 * the server checks and the UI copy.
 */

/** 20 MiB per source PDF (Section 8); the UploadThing route maximum is 32MB. */
export const MAX_SOURCE_PDF_BYTES = 20 * 1024 * 1024;

/** Upload intents expire if the transfer never completes. */
export const UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;

/** Bumped when chunking or indexing changes in a way that needs re-indexing. */
export const INDEX_VERSION = "v1";

/**
 * Documents a user may add per rolling 24 hours, deleted ones included, so
 * deleting and re-uploading cannot get around the file allowance (Section 10).
 * A Postgres quota, not a request rate limit.
 */
export const DAILY_SOURCE_ADMISSIONS: Record<PlanCode, number> = { free: 10, pro: 50 };

/** Section 28: optional title of 1–200 characters. */
export const documentTitleSchema = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(200, "Use 200 characters or fewer.");

/** Input sent with an upload; an empty title means "use the file name". */
export const sourceUploadInputSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, "Use 200 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const renameDocumentSchema = z.object({
  documentId: z.uuid(),
  title: documentTitleSchema,
});
export type RenameDocumentValues = z.infer<typeof renameDocumentSchema>;

/** Section 28: name 1–60 characters (unique per user, checked on the server), description up to 280. */
export const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60, "Use 60 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(280, "Use 280 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type CollectionFormValues = z.input<typeof collectionFormSchema>;

/** Why an upload was refused, shown after "We couldn't add that file." */
export const UPLOAD_REFUSALS = {
  account_inactive: "Your account can't add files right now.",
  file_too_large: "PDFs can be up to 20 MB.",
  not_pdf: "Only PDF files can be uploaded.",
  one_file: "Upload one PDF at a time.",
  file_limit:
    "You've reached the number of PDFs your plan allows. Delete one or upgrade to add more.",
  storage_limit:
    "This file would go over your storage allowance. Delete something or upgrade to add more.",
  daily_limit: "You've added as many documents as you can today. Try again tomorrow.",
  rate_limited: "You're uploading a little fast. Try again in a few minutes.",
  upload_expired: "The upload took too long. Please try again.",
  failed: "Something went wrong while saving it. Please try again.",
} as const;
export type UploadRefusalCode = keyof typeof UPLOAD_REFUSALS;

/** Library status filter groups (Section 24) and the version statuses behind them. */
export const PROCESSING_VERSION_STATUSES = [
  "uploaded",
  "queued",
  "extracting",
  "embedding",
] as const;
export const ATTENTION_VERSION_STATUSES = ["failed", "needs_ocr"] as const;

/* --- Reader ------------------------------------------------------------- */

/** The three PDF highlight colors (Section 15). */
export const HIGHLIGHT_COLORS = ["yellow", "mint", "lavender"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** A rectangle on a page, as fractions of the page's width and height. */
const normalizedRect = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

/**
 * Where an annotation sits: the page, and for highlights and selection notes
 * the quoted text, its character offsets in the page's text layer and the
 * normalized rectangles to draw (zoom-independent).
 */
export const annotationAnchorSchema = z.object({
  page: z.number().int().min(1),
  text: z.string().max(2000).optional(),
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
  rects: z.array(normalizedRect).max(100).optional(),
});
export type AnnotationAnchor = z.infer<typeof annotationAnchorSchema>;

/** Section 28: reader notes up to 5,000 characters. */
export const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Write something for the note.")
  .max(5000, "Use 5,000 characters or fewer.");

export const createAnnotationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("highlight"),
    documentId: z.uuid(),
    anchor: annotationAnchorSchema.extend({
      text: z.string().min(1).max(2000),
      rects: z.array(normalizedRect).min(1).max(100),
    }),
    color: z.enum(HIGHLIGHT_COLORS),
    body: noteBodySchema.optional(),
  }),
  z.object({
    kind: z.literal("note"),
    documentId: z.uuid(),
    anchor: annotationAnchorSchema,
    color: z.enum(HIGHLIGHT_COLORS).optional(),
    body: noteBodySchema,
  }),
]);
export type CreateAnnotationInput = z.input<typeof createAnnotationSchema>;

export const updateAnnotationSchema = z.object({
  annotationId: z.uuid(),
  body: noteBodySchema.optional(),
  color: z.enum(HIGHLIGHT_COLORS).optional(),
});

export const toggleBookmarkSchema = z.object({
  documentId: z.uuid(),
  pageNumber: z.number().int().min(1),
});

/** Saved with debounce and on page hide; restored when the Reader opens. */
export const readingProgressSchema = z.object({
  documentId: z.uuid(),
  pageNumber: z.number().int().min(1),
  position: z.object({
    /** PDF.js scale value: a number or a named fit such as "page-width". */
    scale: z.union([z.number().min(0.1).max(10), z.enum(["page-width", "page-fit", "auto"])]),
    /** How far down the page the top of the viewport is, 0–1. */
    offset: z.number().min(0).max(1),
    pageCount: z.number().int().min(1).optional(),
  }),
});
export type ReadingProgressInput = z.infer<typeof readingProgressSchema>;
