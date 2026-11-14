import { z } from "zod";

/*
 * Publishing, moderation and reports (blueprint Sections 4, 6 "Publishing",
 * 11, 12 and 28). One schema per form; the Server Action parses it again.
 */

/* --- Limits ---------------------------------------------------------------- */

/**
 * Book files have their own allowance, separate from the publisher's personal
 * plan (user decision, 2026-11-09): books that aren't removed, the bytes of
 * book sources and covers, and book uploads per rolling 24 hours.
 */
export const PUBLISHER_BOOK_LIMIT = 20;
export const PUBLISHER_STORAGE_BYTES = 250 * 1024 * 1024;
export const PUBLISHER_DAILY_UPLOADS = 10;

/** Section 25: one JPEG, PNG or WebP cover up to 4 MB. */
export const MAX_COVER_BYTES = 4 * 1024 * 1024;
export const COVER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** UploadThing routes whose files belong to the publishing allowance, not the plan's. */
export const BOOK_FILE_ROUTES = ["bookSourcePdf", "coverImage"] as const;

/* --- Languages and categories ---------------------------------------------- */

/** ISO 639-1 codes offered for book metadata (Section 28); English first (Section 1). */
export const BOOK_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "zh", name: "Chinese" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "la", name: "Latin" },
  { code: "ms", name: "Malay" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" },
] as const;
export type BookLanguageCode = (typeof BOOK_LANGUAGES)[number]["code"];
const LANGUAGE_CODES = BOOK_LANGUAGES.map((language) => language.code) as [
  BookLanguageCode,
  ...BookLanguageCode[],
];

export function languageName(code: string): string {
  return BOOK_LANGUAGES.find((language) => language.code === code)?.name ?? code.toUpperCase();
}

export const categorySlugSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);

/* --- Publisher application and profile ------------------------------------- */

export const PUBLISHER_SLUG_MIN = 3;
export const PUBLISHER_SLUG_MAX = 40;

/** Section 28: 3–40 characters matching `^[a-z0-9-]+$`, unique (checked on the server). */
export const publisherSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(PUBLISHER_SLUG_MIN, `Use at least ${PUBLISHER_SLUG_MIN} characters.`)
  .max(PUBLISHER_SLUG_MAX, `Use ${PUBLISHER_SLUG_MAX} characters or fewer.`)
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only.")
  .refine((slug) => !slug.startsWith("-") && !slug.endsWith("-"), {
    message: "Start and end with a letter or number.",
  });

const publisherNameSchema = z
  .string()
  .trim()
  .min(2, "Enter a publisher name.")
  .max(80, "Use 80 characters or fewer.");

const biographySchema = z
  .string()
  .trim()
  .min(50, "Write at least 50 characters about yourself or your press.")
  .max(1000, "Use 1,000 characters or fewer.");

const optionalWebsiteSchema = z
  .string()
  .trim()
  .max(300, "Use 300 characters or fewer.")
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(
    z
      .url({ protocol: /^https?$/, error: "Enter a full web address starting with https://." })
      .optional(),
  );

export const publisherApplicationSchema = z.object({
  displayName: publisherNameSchema,
  slug: publisherSlugSchema,
  bio: biographySchema,
  website: optionalWebsiteSchema,
  rightsConfirmed: z.literal(true, {
    error: "Confirm that you only publish books you're authorized to share.",
  }),
});
export type PublisherApplicationInput = z.input<typeof publisherApplicationSchema>;
export type PublisherApplicationValues = z.output<typeof publisherApplicationSchema>;

/** Publisher Dashboard → Profile. The slug locks once a book has been published. */
export const publisherProfileSchema = z.object({
  displayName: publisherNameSchema,
  slug: publisherSlugSchema,
  bio: biographySchema,
  website: optionalWebsiteSchema,
});
export type PublisherProfileInput = z.input<typeof publisherProfileSchema>;

/* --- Book drafts and submissions ------------------------------------------- */

export const BOOK_DESCRIPTION_MIN = 50;
export const BOOK_DESCRIPTION_MAX = 3000;
export const BOOK_LICENSE_MIN = 20;
export const BOOK_LICENSE_MAX = 1000;
export const BOOK_CATEGORIES_MAX = 3;

export const createBookSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200, "Use 200 characters or fewer."),
});
export type CreateBookInput = z.input<typeof createBookSchema>;

/**
 * What a draft can hold. Saving checks only lengths, so a publisher can save a
 * half-finished draft; `bookSubmissionSchema` enforces Section 28 on submit.
 */
export const bookDraftSchema = z.object({
  bookId: z.uuid(),
  title: z.string().trim().min(1, "Enter a title.").max(200, "Use 200 characters or fewer."),
  author: z.string().trim().max(200, "Use 200 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(
      BOOK_DESCRIPTION_MAX,
      `Use ${BOOK_DESCRIPTION_MAX.toLocaleString("en")} characters or fewer.`,
    ),
  language: z.enum(LANGUAGE_CODES, { error: "Choose a language." }),
  categories: z
    .array(categorySlugSchema)
    .max(BOOK_CATEGORIES_MAX, `Choose up to ${BOOK_CATEGORIES_MAX} categories.`),
  licenseStatement: z
    .string()
    .trim()
    .max(BOOK_LICENSE_MAX, `Use ${BOOK_LICENSE_MAX.toLocaleString("en")} characters or fewer.`),
});
export type BookDraftInput = z.input<typeof bookDraftSchema>;
export type BookDraftValues = z.output<typeof bookDraftSchema>;

/** Section 28 "Book submission": the stored draft must meet these before review. */
export const bookSubmissionSchema = bookDraftSchema.extend({
  author: z.string().trim().min(1, "Enter the author.").max(200, "Use 200 characters or fewer."),
  description: z
    .string()
    .trim()
    .min(BOOK_DESCRIPTION_MIN, `Write at least ${BOOK_DESCRIPTION_MIN} characters.`)
    .max(
      BOOK_DESCRIPTION_MAX,
      `Use ${BOOK_DESCRIPTION_MAX.toLocaleString("en")} characters or fewer.`,
    ),
  categories: z
    .array(categorySlugSchema)
    .min(1, "Choose at least one category.")
    .max(BOOK_CATEGORIES_MAX, `Choose up to ${BOOK_CATEGORIES_MAX} categories.`),
  licenseStatement: z
    .string()
    .trim()
    .min(BOOK_LICENSE_MIN, `Write at least ${BOOK_LICENSE_MIN} characters.`)
    .max(BOOK_LICENSE_MAX, `Use ${BOOK_LICENSE_MAX.toLocaleString("en")} characters or fewer.`),
  rightsConfirmed: z.literal(true, {
    error: "Confirm that you're authorized to share this book.",
  }),
});
export type BookSubmissionInput = z.input<typeof bookSubmissionSchema>;

export const bookIdInputSchema = z.object({ bookId: z.uuid() });

/** Input sent with a book source or cover upload; the title names revision 1 on a first source. */
export const bookUploadInputSchema = z.object({
  bookId: z.uuid(),
  title: z
    .string()
    .trim()
    .max(200, "Use 200 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

/* --- Statuses -------------------------------------------------------------- */

export const BOOK_STATUSES = ["draft", "pending", "published", "unpublished", "removed"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];
export const BOOK_REVISION_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export type BookRevisionStatus = (typeof BOOK_REVISION_STATUSES)[number];
export const PUBLISHER_STATUSES = ["applicant", "approved", "rejected", "suspended"] as const;
export type PublisherStatus = (typeof PUBLISHER_STATUSES)[number];

/** Publisher Dashboard filter (Section 24): status of the listing as the publisher sees it. */
export const PUBLISHING_LIST_STATUSES = [
  "all",
  "draft",
  "pending",
  "published",
  "rejected",
  "unpublished",
] as const;
export type PublishingListStatus = (typeof PUBLISHING_LIST_STATUSES)[number];
export const PUBLISHING_PAGE_SIZE = 20;

/* --- Reports --------------------------------------------------------------- */

export const REPORT_REASONS = [
  "copyright",
  "inappropriate",
  "incorrect_metadata",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  copyright: "Copyright or permission",
  inappropriate: "Inappropriate content",
  incorrect_metadata: "Incorrect title, author or details",
  other: "Something else",
};
export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Section 28 "Report a concern": details of 10–1000 characters, required for "other". */
export const reportFormSchema = z
  .object({
    bookId: z.uuid(),
    reason: z.enum(REPORT_REASONS, { error: "Choose a reason." }),
    details: z
      .string()
      .trim()
      .max(1000, "Use 1,000 characters or fewer.")
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .superRefine((value, context) => {
    if (value.details !== undefined && value.details.length < 10) {
      context.addIssue({
        code: "custom",
        path: ["details"],
        message: "Write at least 10 characters.",
      });
    }
    if (value.reason === "other" && value.details === undefined) {
      context.addIssue({
        code: "custom",
        path: ["details"],
        message: "Tell us what's wrong, in at least 10 characters.",
      });
    }
  });
export type ReportFormInput = z.input<typeof reportFormSchema>;

/* --- Moderation and review decisions --------------------------------------- */

export const MODERATION_ACTIONS = ["approve", "reject", "takedown"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

const decisionReason = z
  .string()
  .trim()
  .max(1000, "Use 1,000 characters or fewer.")
  .optional()
  .transform((value) => (value ? value : undefined));

function requireReason<T extends { action: string; reason?: string | undefined }>(
  needsReason: (action: T["action"]) => boolean,
) {
  return (value: T, context: z.RefinementCtx) => {
    const length = value.reason?.length ?? 0;
    if (needsReason(value.action) && length === 0) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Give a reason." });
    } else if (length > 0 && length < 10) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Write at least 10 characters.",
      });
    }
  };
}

/** Section 28 "Moderation decision": a reason of 10–1000 characters for reject and takedown. */
export const moderationDecisionSchema = z
  .object({
    revisionId: z.uuid(),
    action: z.enum(["approve", "reject"]),
    reason: decisionReason,
  })
  .superRefine(requireReason((action) => action === "reject"));
export type ModerationDecisionInput = z.input<typeof moderationDecisionSchema>;

export const takedownSchema = z
  .object({
    bookId: z.uuid(),
    action: z.literal("takedown"),
    reason: decisionReason,
    /** The report that led here, resolved with the same reason. */
    reportId: z.uuid().optional(),
  })
  .superRefine(requireReason(() => true));
export type TakedownInput = z.input<typeof takedownSchema>;

export const reportResolutionSchema = z
  .object({
    reportId: z.uuid(),
    action: z.enum(["resolve", "dismiss"]),
    reason: decisionReason,
  })
  .superRefine(requireReason(() => false));
export type ReportResolutionInput = z.input<typeof reportResolutionSchema>;

/** Publisher applications: approve grants the role; reject needs a reason. */
export const applicationDecisionSchema = z
  .object({
    profileId: z.uuid(),
    action: z.enum(["approve", "reject"]),
    reason: decisionReason,
  })
  .superRefine(requireReason((action) => action === "reject"));
export type ApplicationDecisionInput = z.input<typeof applicationDecisionSchema>;

/* --- Refusals -------------------------------------------------------------- */

export const PUBLISHING_REFUSALS = {
  not_found: "This book isn't available anymore.",
  account_inactive: "Your account can't do this right now.",
  email_unverified:
    "Verify your email address with your sign-in provider before applying to publish.",
  admin_account: "Administrator accounts can't publish. Apply from a separate reader account.",
  slug_taken: "That address is already taken. Try another.",
  slug_locked: "Your address can't change after your first book is published.",
  already_applied: "Your application is already waiting for review.",
  already_publisher: "You're already a publisher.",
  not_publisher: "Only approved publishers can do this.",
  book_limit: `You can have up to ${PUBLISHER_BOOK_LIMIT} books. Unpublish or delete a draft to add another.`,
  storage_limit: "This file would go over your 250 MB of book files. Remove a draft's files first.",
  daily_limit: `You can upload up to ${PUBLISHER_DAILY_UPLOADS} book files a day. Try again tomorrow.`,
  no_source: "Upload the book's PDF first.",
  source_processing: "The PDF is still being processed. You can submit once it's ready.",
  source_failed: "The PDF couldn't be processed. Upload a different file.",
  incomplete: "Fill in the missing details before submitting.",
  pending: "This book is waiting for review, so it can't be changed right now.",
  removed: "This book was removed by moderation and can't be changed.",
  not_published: "Only a published book can be unpublished.",
  nothing_to_revise: "There's already a draft to edit.",
  already_decided: "Someone already reviewed this. Refresh to see the latest.",
  cannot_report: "You can't report this book.",
  already_reported: "You've already reported this book. We'll review it soon.",
} as const;
export type PublishingRefusalCode = keyof typeof PUBLISHING_REFUSALS;

export const BOOK_UPLOAD_REFUSALS = {
  ...PUBLISHING_REFUSALS,
  one_file: "Upload one file at a time.",
  not_pdf: "Only PDF files can be uploaded.",
  file_too_large: "PDFs can be up to 20 MB.",
  not_image: "Choose a JPEG, PNG or WebP image up to 4 MB.",
  rate_limited: "You're uploading a little fast. Try again in a few minutes.",
  upload_expired: "The upload took too long. Please try again.",
} as const;
export type BookUploadRefusalCode = keyof typeof BOOK_UPLOAD_REFUSALS;
