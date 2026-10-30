import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

/**
 * Next.js 16 proxy (formerly middleware). Mounts the Auth0 routes
 * (/auth/login, /auth/logout, /auth/callback) and rolling sessions.
 * Phase 4 adds the global Upstash rate limit in front of it (Section 23).
 */
export async function proxy(request: NextRequest) {
  if (!auth0) {
    // Development before Auth0 is configured: the site works, sign-in explains why it can't.
    if (request.nextUrl.pathname.startsWith("/auth/")) {
      return new NextResponse(
        "Auth0 is not configured. Set the AUTH0_* variables in apps/web/.env.local (see docs/setup/third-party-services.md).",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    return NextResponse.next();
  }
  return auth0.middleware(request);
}

export const config = {
  // Broad matcher required for rolling sessions; static assets and icons are skipped.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icons/|sitemap.xml|robots.txt).*)",
  ],
};
