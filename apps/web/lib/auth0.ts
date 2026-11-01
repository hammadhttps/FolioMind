import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { DEFAULT_RETURN_TO, safeReturnTo } from "./auth/return-to";
import type { SignInErrorCode } from "./auth/sign-in-errors";

/**
 * Auth0 SDK client (blueprint Sections 3 and 22). Configuration is passed from
 * the validated environment. In development it is `null` until the AUTH0_*
 * variables are set; staging/production validation requires them.
 *
 * FolioMind uses its own sign-in screen (/login): Google and GitHub go straight
 * to the provider, email uses Passwordless codes, and callback errors return to
 * /login, so Auth0's hosted login page is never part of the flow.
 * Hooks, user upsert and identity rules are added in Phase 4.
 */
function createAuth0(): Auth0Client | null {
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET } = env;
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET || !AUTH0_SECRET) return null;
  return new Auth0Client({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    clientSecret: AUTH0_CLIENT_SECRET,
    secret: AUTH0_SECRET,
    appBaseUrl: env.APP_BASE_URL,
    signInReturnToPath: DEFAULT_RETURN_TO,
    // The browser never needs Auth0 access tokens.
    enableAccessTokenEndpoint: false,
    async onCallback(error, context) {
      if (error) {
        const params = new URLSearchParams({ auth_error: callbackErrorCode(error) });
        if (context.returnTo) params.set("returnTo", safeReturnTo(context.returnTo));
        return redirectTo(`/login?${params.toString()}`);
      }
      return redirectTo(safeReturnTo(context.returnTo));
    },
  });
}

/**
 * Relative Location header: some SDK error paths (for example a missing state
 * cookie) provide no appBaseUrl. The proxy resolves it against the request
 * before responding.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

/** The provider's "access_denied" means the person backed out of the consent screen. */
function callbackErrorCode(error: { code?: string; cause?: unknown }): SignInErrorCode {
  const cause = error.cause as { code?: string } | undefined;
  return cause?.code === "access_denied" ? "cancelled" : "failed";
}

export const auth0 = createAuth0();
