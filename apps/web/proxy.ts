import { cacheKey, createRedis } from "@foliomind/domain";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { appEnv, env } from "@/env";
import { safeReturnTo } from "@/lib/auth/return-to";
import { expireSessionCookies, REFUSE_SESSION_HEADER } from "@/lib/auth/session-cookies";
import { isSocialConnection, type SignInErrorCode } from "@/lib/auth/sign-in-errors";
import { auth0 } from "@/lib/auth0";
import { createRateLimiter, ipIdentifier, rateLimitResponse } from "@/lib/rate-limit/core";

/**
 * Next.js 16 proxy (formerly middleware). In order: the global Upstash rate
 * limit (Section 23), FolioMind's own sign-out route, the Auth0 routes
 * FolioMind uses with rolling sessions, and the signed-in gate that sends
 * guests to FolioMind's sign-in screen (/login) with a return path. Auth0's
 * hosted login page is never used: /auth/login only proceeds for the Google
 * and GitHub connections, which go straight to the provider.
 */
const SIGNED_IN_PREFIXES = ["/dashboard", "/read", "/admin"];

/** The only Auth0 SDK routes FolioMind serves; MFA, passkey, passwordless and token routes stay closed. */
const AUTH_ROUTES = new Set(["/auth/login", "/auth/logout", "/auth/callback", "/auth/profile"]);

/** Reasons `/session/end` signs a user out for, shown on /login. */
const SIGN_OUT_REASONS = new Set<SignInErrorCode>(["suspended", "deleted"]);

const checkRateLimit = createRateLimiter({
  redis: createRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    retries: 0,
  }),
  keyPrefix: cacheKey(appEnv),
});

/** Signature verification is the gate for these (Section 23). */
function isRateLimitExempt(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  return (
    pathname === "/api/webhooks/stripe" ||
    pathname === "/api/inngest" ||
    (pathname === "/api/uploadthing" && request.headers.has("uploadthing-hook"))
  );
}

function requiresSession(pathname: string): boolean {
  return SIGNED_IN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectToSignIn(request: NextRequest, returnTo: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("returnTo", safeReturnTo(returnTo));
  return NextResponse.redirect(url);
}

/**
 * The proxy runtime rejects relative redirect URLs (TypeError: Invalid URL), but
 * onCallback returns relative ones because the SDK gives it no appBaseUrl on
 * some error paths. Resolve them against the request before returning.
 */
function withAbsoluteLocation(response: NextResponse, request: NextRequest): NextResponse {
  const location = response.headers.get("location");
  if (location?.startsWith("/")) {
    response.headers.set("location", new URL(location, request.url).toString());
  }
  return response;
}

/**
 * Ends FolioMind's session for a suspended or deleting account and explains
 * why on /login. The Auth0 session may remain, but the callback refuses these
 * accounts, so it cannot sign them back in.
 */
function endSession(request: NextRequest): NextResponse {
  const reason = request.nextUrl.searchParams.get("reason");
  const code = SIGN_OUT_REASONS.has(reason as SignInErrorCode) ? reason : "failed";
  const response = NextResponse.redirect(new URL(`/login?auth_error=${code}`, request.url));
  return expireSessionCookies(response, request);
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search, searchParams } = request.nextUrl;

  if (!isRateLimitExempt(request)) {
    const decision = await checkRateLimit(
      "global",
      ipIdentifier(request.headers, env.RATE_LIMIT_IP_SECRET),
      { waitUntil: (promise) => event.waitUntil(promise) },
    );
    if (!decision.allowed) return rateLimitResponse(decision);
  }

  if (pathname === "/session/end") return endSession(request);

  if (pathname.startsWith("/auth/")) {
    if (request.method !== "GET" || !AUTH_ROUTES.has(pathname)) {
      return new NextResponse(null, { status: 404 });
    }
    // Without a social connection the SDK would show Auth0's hosted page; use ours instead.
    if (pathname === "/auth/login" && !isSocialConnection(searchParams.get("connection"))) {
      return redirectToSignIn(request, searchParams.get("returnTo") ?? "/dashboard");
    }
  }

  if (!auth0) {
    // Development before Auth0 is configured: the site works, sign-in explains why it can't.
    if (pathname.startsWith("/auth/")) {
      return new NextResponse(
        "Auth0 is not configured. Set the AUTH0_* variables in apps/web/.env.local (see docs/setup/third-party-services.md).",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    return requiresSession(pathname)
      ? redirectToSignIn(request, `${pathname}${search}`)
      : NextResponse.next();
  }

  const authResponse = await auth0.middleware(request);
  if (pathname.startsWith("/auth/")) {
    if (authResponse.headers.has(REFUSE_SESSION_HEADER)) {
      expireSessionCookies(authResponse, request);
    }
    return withAbsoluteLocation(authResponse, request);
  }

  if (requiresSession(pathname) && !(await auth0.getSession(request))) {
    return redirectToSignIn(request, `${pathname}${search}`);
  }
  return authResponse;
}

export const config = {
  // Broad matcher required for rolling sessions; static assets and icons are skipped.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|opengraph-image|icons/|sitemap.xml|robots.txt).*)",
  ],
};
