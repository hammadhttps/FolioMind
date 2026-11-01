/**
 * Post-sign-in destinations (blueprint Section 22): only local paths are
 * allowed, so a crafted link can never send a user to another site, and the
 * Auth0 routes themselves are excluded to avoid redirect loops.
 */
export const DEFAULT_RETURN_TO = "/dashboard";

const LOCAL_ORIGIN = "http://foliomind.local";
const MAX_LENGTH = 2048;

export function safeReturnTo(value: unknown, fallback: string = DEFAULT_RETURN_TO): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return fallback;
  }
  // Must be a root-relative path: not protocol-relative (//host) or /\host.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  // Control characters and backslashes have no place in an app path.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, LOCAL_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== LOCAL_ORIGIN) return fallback;
  if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}

export type SignInConnection = "google-oauth2" | "github";

/**
 * Auth0 SDK login route for a social connection. The connection always skips
 * Auth0's hosted page and goes straight to Google or GitHub. Google gets
 * `prompt=select_account` (Auth0 forwards it), so its account chooser always
 * appears instead of silently reusing the last Google account.
 */
export function loginHref({
  returnTo,
  connection,
}: {
  returnTo?: string;
  connection: SignInConnection;
}): string {
  const params = new URLSearchParams({
    connection,
    ...(connection === "google-oauth2" ? { prompt: "select_account" } : {}),
    returnTo: safeReturnTo(returnTo),
  });
  return `/auth/login?${params.toString()}`;
}

/** FolioMind's own sign-in screen. */
export function signInPageHref(returnTo?: string): string {
  return `/login?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) }).toString()}`;
}
