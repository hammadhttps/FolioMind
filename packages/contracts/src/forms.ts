import { z } from "zod";

/*
 * Shared shapes for forms and the Server Actions that parse their input again
 * (blueprint Section 28). Form schemas are added here as features need them.
 */

/** Server Action result shape (blueprint Section 6 conventions). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      formError?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      retryAfterSeconds?: number;
    };

/** Settings → Profile (Section 28): display name 1–60 characters. */
export const profileFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(60, "Use 60 characters or fewer."),
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** Settings → Appearance; light is the initial default (Section 15). */
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;
