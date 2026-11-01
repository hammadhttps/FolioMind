import type { IdentityResultCode } from "@foliomind/contracts";
import { linkIdentity } from "@foliomind/domain";
import { NextResponse, type NextRequest } from "next/server";
import { auth0IdentityAdmin } from "@/lib/auth/identity-admin";
import {
  completeLink,
  LINK_CALLBACK_PATH,
  LINK_COOKIE,
  LinkCallbackError,
  LinkUnavailableError,
} from "@/lib/auth/link";
import { getDb } from "@/lib/clients";
import { getCurrentUser } from "@/lib/session";

/**
 * Link callback (Section 22 rules 4 and 5): verifies the separate
 * authorization's ID token, links the identity to the signed-in account through
 * the Management API, and returns to Settings with the outcome. The current
 * session is never replaced.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?returnTo=%2Fdashboard%2Fsettings", request.url));
  }

  let code: IdentityResultCode;
  try {
    const link = await completeLink({
      cookie: request.cookies.get(LINK_COOKIE)?.value,
      searchParams: request.nextUrl.searchParams,
      requestUrl: request.url,
    });
    if (link.userId !== user.id || user.status !== "active") {
      code = "link_failed";
    } else {
      const outcome = await linkIdentity(getDb(), auth0IdentityAdmin, {
        user,
        secondarySub: link.secondarySub,
        connection: link.connection,
      });
      code = outcome.ok ? "linked" : outcome.code;
    }
  } catch (error) {
    if (error instanceof LinkCallbackError && error.reason === "cancelled") {
      code = "link_cancelled";
    } else if (error instanceof LinkUnavailableError) {
      code = "unavailable";
    } else {
      console.error(
        JSON.stringify({
          event: "identity.link_failed",
          reason: error instanceof LinkCallbackError ? error.reason : "management_api",
        }),
      );
      code = "link_failed";
    }
  }

  const response = NextResponse.redirect(
    new URL(`/dashboard/settings?identity=${code}`, request.url),
  );
  response.cookies.set(LINK_COOKIE, "", { path: LINK_CALLBACK_PATH, maxAge: 0 });
  return response;
}
