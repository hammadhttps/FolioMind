/**
 * Sign-in problems shown on FolioMind's own sign-in screen. The URL carries only
 * these coarse codes (`?auth_error=`), never provider error text.
 */
export const SIGN_IN_ERRORS = {
  cancelled: "Sign-in was cancelled. Choose a way to continue when you're ready.",
  failed: "We couldn't sign you in. Please try again.",
  unavailable: "Sign-in isn't available right now. Please try again in a little while.",
  unsupported: "That sign-in method isn't available. Continue with Google or GitHub.",
  no_email:
    "We couldn't get an email address from that account. Add one to it, or continue with another method.",
  suspended: "This account is suspended, so you can't sign in right now.",
  deleted: "This account is being deleted and can no longer sign in.",
} as const;

export type SignInErrorCode = keyof typeof SIGN_IN_ERRORS;

export function signInErrorMessage(code: unknown): string | null {
  if (typeof code !== "string") return null;
  return code in SIGN_IN_ERRORS ? SIGN_IN_ERRORS[code as SignInErrorCode] : SIGN_IN_ERRORS.failed;
}

/** Section 22 rule 3, word for word. */
export const AUTH_NOTICES = {
  "existing-account":
    "You already have a FolioMind account with this email. Sign in with your original method, then connect this one in Settings.",
} as const;

export type AuthNoticeCode = keyof typeof AUTH_NOTICES;

export function authNoticeMessage(code: unknown): string | null {
  return typeof code === "string" && code in AUTH_NOTICES
    ? AUTH_NOTICES[code as AuthNoticeCode]
    : null;
}

/** Only Google and GitHub may skip FolioMind's screen (they go straight to the provider). */
export const SOCIAL_CONNECTIONS = ["google-oauth2", "github"] as const;
export type SocialConnection = (typeof SOCIAL_CONNECTIONS)[number];

export function isSocialConnection(value: unknown): value is SocialConnection {
  return typeof value === "string" && (SOCIAL_CONNECTIONS as readonly string[]).includes(value);
}
