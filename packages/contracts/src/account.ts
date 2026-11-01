import { z } from "zod";

/*
 * Sign-in methods (blueprint Section 22): Google and GitHub are the only
 * connections FolioMind offers (email sign-in was removed, PROGRESS.md P3).
 */

export const SIGN_IN_PROVIDERS = ["google-oauth2", "github"] as const;
export const signInProviderSchema = z.enum(SIGN_IN_PROVIDERS);
export type SignInProvider = z.infer<typeof signInProviderSchema>;

export const SIGN_IN_PROVIDER_NAMES: Record<SignInProvider, string> = {
  "google-oauth2": "Google",
  github: "GitHub",
};

/** `POST /api/account/identities`: start connecting another method. */
export const linkIdentityRequestSchema = z.object({ connection: signInProviderSchema });
export type LinkIdentityRequest = z.infer<typeof linkIdentityRequestSchema>;

/** Results the link callback and the disconnect endpoint report back to Settings. */
export const IDENTITY_RESULT_CODES = [
  "linked",
  "unlinked",
  "already_linked",
  "account_has_content",
  "email_unverified",
  "reauthentication_required",
  "last_method",
  "primary_method",
  "not_linked",
  "link_cancelled",
  "link_failed",
  "unavailable",
] as const;
export type IdentityResultCode = (typeof IDENTITY_RESULT_CODES)[number];
export const identityResultCodeSchema = z.enum(IDENTITY_RESULT_CODES);
