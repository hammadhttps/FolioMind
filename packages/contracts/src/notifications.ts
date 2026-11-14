import { z } from "zod";

/*
 * In-app notifications (blueprint Sections 7 and 11). Push was dropped by the
 * user on 2026-11-04, so notifications appear in the bell only. Titles and
 * bodies are written by FolioMind from the type, never from document text.
 */

export const NOTIFICATION_TYPES = [
  "document_ready",
  "document_failed",
  "document_needs_ocr",
  "import_failed",
  "draft_ready",
  "generation_failed",
  "export_ready",
  "export_failed",
  "publisher_approved",
  "publisher_rejected",
  "submission_approved",
  "submission_rejected",
  "book_taken_down",
  "publisher_new_book",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/**
 * The Settings switches (Section 28 "Notification preferences"): one per group.
 * Missing keys mean "on". A followed publisher's updates also need that
 * follow's own notify switch (Section 11 "Follow").
 */
export const NOTIFICATION_PREFERENCES = {
  documents: {
    label: "Document processing",
    description: "When an upload or imported article is ready, or couldn't be processed.",
    types: ["document_ready", "document_failed", "document_needs_ocr", "import_failed"],
  },
  projects: {
    label: "Projects",
    description: "When a draft or a PDF export is ready, or couldn't be finished.",
    types: ["draft_ready", "generation_failed", "export_ready", "export_failed"],
  },
  publishing: {
    label: "Publishing",
    description: "Decisions about your publisher application and the books you submit.",
    types: [
      "publisher_approved",
      "publisher_rejected",
      "submission_approved",
      "submission_rejected",
      "book_taken_down",
    ],
  },
  following: {
    label: "Publishers you follow",
    description: "When a publisher you follow shares a new or updated book.",
    types: ["publisher_new_book"],
  },
} as const satisfies Record<
  string,
  { label: string; description: string; types: NotificationType[] }
>;
export type NotificationPreferenceKey = keyof typeof NOTIFICATION_PREFERENCES;

export function preferenceFor(type: NotificationType): NotificationPreferenceKey {
  for (const [key, group] of Object.entries(NOTIFICATION_PREFERENCES)) {
    if ((group.types as readonly string[]).includes(type)) return key as NotificationPreferenceKey;
  }
  return "documents";
}

export const notificationPreferencesSchema = z.object({
  documents: z.boolean(),
  projects: z.boolean(),
  publishing: z.boolean(),
  following: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** Stored settings are a loose map; unknown or missing keys default to on. */
export function readNotificationPreferences(
  stored: Record<string, unknown> | null | undefined,
): NotificationPreferences {
  return {
    documents: stored?.documents !== false,
    projects: stored?.projects !== false,
    publishing: stored?.publishing !== false,
    following: stored?.following !== false,
  };
}

/** The drawer's page size (Section 24 keyset "Load more"). */
export const NOTIFICATION_PAGE_SIZE = 20;

/** Notifications older than this are removed by the daily cleanup. */
export const NOTIFICATION_RETENTION_DAYS = 90;
