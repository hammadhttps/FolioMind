import { env } from "@/env";

/*
 * CSRF protection for cookie-authenticated route-handler mutations (blueprint
 * Section 11). Browsers always send Origin on cross-site POST/PATCH/DELETE, so
 * a mutation must come from FolioMind's own origin. Server Actions get the same
 * check from Next.js.
 */

export function isSameOriginRequest(request: Request): boolean {
  const allowed = new Set([new URL(request.url).origin]);
  if (env.APP_BASE_URL) allowed.add(new URL(env.APP_BASE_URL).origin);

  const origin = request.headers.get("origin");
  if (origin) return allowed.has(origin);
  // No Origin header: only same-origin fetches that announce themselves pass.
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function apiError(status: number, code: string, message: string, headers?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** 403 for a mutation from another origin, or null when the request may proceed. */
export function rejectCrossOrigin(request: Request): Response | null {
  return isSameOriginRequest(request)
    ? null
    : apiError(403, "bad_origin", "This request must come from FolioMind.");
}
