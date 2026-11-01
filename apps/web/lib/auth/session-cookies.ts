import type { NextRequest, NextResponse } from "next/server";

/*
 * The Auth0 SDK writes its session cookie after `onCallback` returns, so the
 * hook cannot refuse a session by itself. When FolioMind refuses a sign-in
 * (Section 22 rule 3, suspension), the hook marks its response with this
 * header and the proxy expires the session cookies before the response leaves.
 */
export const REFUSE_SESSION_HEADER = "x-foliomind-refuse-session";

/** `__session` plus its chunks `__session__0…` (the SDK's stateless session store). */
const SESSION_COOKIE = /^__session(__\d+)?$/;

/** Expires every session cookie the request carries or the response sets. */
export function expireSessionCookies(response: NextResponse, request: NextRequest): NextResponse {
  const names = new Set([
    ...request.cookies.getAll().map((cookie) => cookie.name),
    ...response.cookies.getAll().map((cookie) => cookie.name),
    "__session",
  ]);
  for (const name of names) {
    if (SESSION_COOKIE.test(name)) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  response.headers.delete(REFUSE_SESSION_HEADER);
  return response;
}
