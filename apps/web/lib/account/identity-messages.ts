import type { IdentityResultCode } from "@foliomind/contracts";

/** Settings copy for each sign-in method outcome (Section 20 tone). */
export const IDENTITY_MESSAGES: Record<IdentityResultCode, string> = {
  linked: "Sign-in method connected. You can now use it to sign in.",
  unlinked: "Sign-in method disconnected.",
  already_linked: "That sign-in method is already connected to your account.",
  account_has_content:
    "That sign-in method already belongs to another FolioMind account with saved work, so it can't be connected here.",
  email_unverified:
    "Verify your email address with your sign-in provider before connecting another method.",
  reauthentication_required: "For your security, sign in again before disconnecting a method.",
  last_method: "You need at least one way to sign in, so this method can't be disconnected.",
  primary_method: "This is the method your account was created with, so it can't be disconnected.",
  not_linked: "That sign-in method isn't connected to your account.",
  link_cancelled: "Connecting was cancelled. Nothing changed.",
  link_failed: "We couldn't connect that sign-in method. Please try again.",
  unavailable: "Connecting sign-in methods isn't available right now. Please try again later.",
};

export function identityMessage(code: unknown): string | null {
  return typeof code === "string" && code in IDENTITY_MESSAGES
    ? IDENTITY_MESSAGES[code as IdentityResultCode]
    : null;
}

export const IDENTITY_SUCCESS_CODES: readonly IdentityResultCode[] = ["linked", "unlinked"];
