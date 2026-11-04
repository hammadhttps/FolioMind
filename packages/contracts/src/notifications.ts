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
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/**
 * The Settings switches (Section 28 "Notification preferences"): one per group.
 * Missing keys mean "on". Moderation and publisher updates join in Phase 9.
 */
export const NOTIFICATION_PREFERENCES = {
  documents: {
    label: "Document processing",
    description: "When an upload or imported article is ready, or couldn't be processed.",
    types: ["document_ready", "document_failed", "document_needs_ocr", "import_failed"],
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
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** Stored settings are a loose map; unknown or missing keys default to on. */
export function readNotificationPreferences(
  stored: Record<string, unknown> | null | undefined,
): NotificationPreferences {
  return { documents: stored?.documents !== false };
}

/** The drawer's page size (Section 24 keyset "Load more"). */
export const NOTIFICATION_PAGE_SIZE = 20;

/** Notifications older than this are removed by the daily cleanup. */
export const NOTIFICATION_RETENTION_DAYS = 90;
