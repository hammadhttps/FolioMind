import { Auth0Client, filterDefaultIdTokenClaims } from "@auth0/nextjs-auth0/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { CACHE_TTL_SECONDS, signIn, writeCache, type SignInOutcome } from "@foliomind/domain";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { DEFAULT_RETURN_TO, safeReturnTo } from "./auth/return-to";
import { auth0IdentityAdmin } from "./auth/identity-admin";
import { LOCAL_USER_CLAIM } from "./auth/claims";
import { REFUSE_SESSION_HEADER } from "./auth/session-cookies";
import type { SignInErrorCode } from "./auth/sign-in-errors";
import { getCacheKeys, getDb, getRequestRedis } from "./clients";

/**
 * Auth0 SDK client (blueprint Sections 3 and 22). Configuration is passed from
 * the validated environment. In development it is `null` until the AUTH0_*
 * variables are set; staging/production validation requires them.
 *
 * FolioMind uses its own sign-in screen (/login): Google and GitHub go straight
 * to the provider and callback errors return to /login, so Auth0's hosted login
 * page is never part of the flow. After Auth0 verifies the ID token, the
 * callback upserts the local user by `sub` and applies the Section 22 identity
 * rules before any session is kept.
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
    async onCallback(error, context, session) {
      if (error || !session) {
        const params = new URLSearchParams({
          auth_error: error ? callbackErrorCode(error) : "failed",
        });
        if (context.returnTo) params.set("returnTo", safeReturnTo(context.returnTo));
        return redirectTo(`/login?${params.toString()}`);
      }

      let outcome: SignInOutcome;
      try {
        outcome = await signIn(getDb(), sessionClaims(session));
      } catch (cause) {
        console.error(JSON.stringify({ event: "auth.signin_failed", error: errorName(cause) }));
        return refuseSession("/login?auth_error=failed");
      }

      if (outcome.kind === "refused") {
        if (outcome.deleteAuth0User) await deleteOrphan(session.user.sub);
        return refuseSession(
          outcome.reason === "existing_account"
            ? "/login?auth_notice=existing-account"
            : `/login?auth_error=${REFUSAL_ERRORS[outcome.reason]}`,
        );
      }

      // Kept in the session so later requests find the local user without a lookup.
      session.user[LOCAL_USER_CLAIM] = outcome.user.id;
      await writeCache(
        getRequestRedis(),
        getCacheKeys().userSnapshot(outcome.user.id),
        outcome.user,
        CACHE_TTL_SECONDS.userSnapshot,
      );
      return redirectTo(safeReturnTo(context.returnTo));
    },
    // The SDK's default claim filter, plus the local user ID set above.
    async beforeSessionSaved(session) {
      const localUserId = session.user[LOCAL_USER_CLAIM];
      return {
        ...session,
        user: {
          ...filterDefaultIdTokenClaims(session.user),
          ...(typeof localUserId === "string" ? { [LOCAL_USER_CLAIM]: localUserId } : {}),
        },
      };
    },
  });
}

const REFUSAL_ERRORS = {
  unsupported_method: "unsupported",
  no_email: "no_email",
  suspended: "suspended",
  deleted: "deleted",
} as const satisfies Record<string, SignInErrorCode>;

function sessionClaims(session: SessionData) {
  const user = session.user;
  return {
    sub: user.sub,
    email: typeof user.email === "string" ? user.email : null,
    emailVerified: user.email_verified === true,
    name: typeof user.name === "string" ? user.name : null,
    nickname: typeof user.nickname === "string" ? user.nickname : null,
    picture: typeof user.picture === "string" ? user.picture : null,
  };
}

/**
 * Rule 3: the new Auth0 user that collided with an existing account is deleted,
 * so no second account appears later. Failure is logged, never shown.
 */
async function deleteOrphan(sub: string): Promise<void> {
  try {
    await auth0IdentityAdmin.deleteUser(sub);
  } catch (cause) {
    console.error(JSON.stringify({ event: "auth.orphan_delete_failed", error: errorName(cause) }));
  }
}

/**
 * Relative Location header: some SDK error paths (for example a missing state
 * cookie) provide no appBaseUrl. The proxy resolves it against the request
 * before responding.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

/** The proxy expires the session cookies the SDK writes onto this response. */
function refuseSession(path: string): NextResponse {
  const response = redirectTo(path);
  response.headers.set(REFUSE_SESSION_HEADER, "1");
  return response;
}

/** The provider's "access_denied" means the person backed out of the consent screen. */
function callbackErrorCode(error: { code?: string; cause?: unknown }): SignInErrorCode {
  const cause = error.cause as { code?: string } | undefined;
  return cause?.code === "access_denied" ? "cancelled" : "failed";
}

/** Error class names only: messages from drivers can carry connection details. */
function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause;
}

export const auth0 = createAuth0();
