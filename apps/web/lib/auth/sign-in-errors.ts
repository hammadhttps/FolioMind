/**
 * Sign-in problems shown on FolioMind's own sign-in screen. The URL carries only
 * these coarse codes (`?auth_error=`), never provider error text.
 */
export const SIGN_IN_ERRORS = {
  cancelled: "Sign-in was cancelled. Choose a way to continue when you're ready.",
  failed: "We couldn't sign you in. Please try again.",
  unavailable: "Sign-in isn't available right now. Please try again in a little while.",
} as const;

export type SignInErrorCode = keyof typeof SIGN_IN_ERRORS;

export function signInErrorMessage(code: unknown): string | null {
  if (typeof code !== "string") return null;
  return code in SIGN_IN_ERRORS ? SIGN_IN_ERRORS[code as SignInErrorCode] : SIGN_IN_ERRORS.failed;
}

/** Only Google and GitHub may skip FolioMind's screen (they go straight to the provider). */
export const SOCIAL_CONNECTIONS = ["google-oauth2", "github"] as const;
export type SocialConnection = (typeof SOCIAL_CONNECTIONS)[number];

export function isSocialConnection(value: unknown): value is SocialConnection {
  return typeof value === "string" && (SOCIAL_CONNECTIONS as readonly string[]).includes(value);
}
