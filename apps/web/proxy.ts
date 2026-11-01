import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/auth/return-to";
import { isSocialConnection } from "@/lib/auth/sign-in-errors";
import { auth0 } from "@/lib/auth0";

/**
 * Next.js 16 proxy (formerly middleware). Mounts the Auth0 routes FolioMind
 * uses, keeps sessions rolling and sends guests on signed-in routes to
 * FolioMind's own sign-in screen (/login), returning to the requested page.
 * Auth0's hosted login page is never used: /auth/login only proceeds for the
 * Google and GitHub connections, which go straight to the provider.
 * Phase 4 adds the global Upstash rate limit in front of it (Section 23).
 */
const SIGNED_IN_PREFIXES = ["/dashboard", "/read", "/admin"];

/** The only Auth0 SDK routes FolioMind serves; MFA, passkey, passwordless and token routes stay closed. */
const AUTH_ROUTES = new Set(["/auth/login", "/auth/logout", "/auth/callback", "/auth/profile"]);

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

export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;

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
  if (pathname.startsWith("/auth/")) return withAbsoluteLocation(authResponse, request);

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
