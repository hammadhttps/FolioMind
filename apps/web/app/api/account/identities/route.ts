import { linkIdentityRequestSchema } from "@foliomind/contracts";
import { NextResponse } from "next/server";
import { IDENTITY_MESSAGES } from "@/lib/account/identity-messages";
import { LINK_CALLBACK_PATH, LINK_COOKIE, LinkUnavailableError, startLink } from "@/lib/auth/link";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

/**
 * `POST /api/account/identities` — start connecting Google or GitHub to the
 * signed-in account (Section 22 rule 4). Answers with the authorization URL;
 * the browser navigates there and returns to the link callback.
 */
const startConnect = withRateLimit("accountSecurity", async (request: Request) => {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to connect a sign-in method.");
  if (user.status !== "active")
    return apiError(403, "account_inactive", IDENTITY_MESSAGES.link_failed);
  // Rule 2: unverified users cannot link methods until they verify.
  if (!user.emailVerified)
    return apiError(403, "email_unverified", IDENTITY_MESSAGES.email_unverified);

  const body = linkIdentityRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "invalid_request", "Choose Google or GitHub.");

  try {
    const { authorizeUrl, cookie, maxAge } = await startLink({
      userId: user.id,
      connection: body.data.connection,
      requestUrl: request.url,
    });
    const response = NextResponse.json({ redirectUrl: authorizeUrl });
    response.cookies.set(LINK_COOKIE, cookie, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: LINK_CALLBACK_PATH,
      maxAge,
    });
    return response;
  } catch (error) {
    if (error instanceof LinkUnavailableError) {
      return apiError(503, "unavailable", IDENTITY_MESSAGES.unavailable);
    }
    throw error;
  }
});

export async function POST(request: Request, context: unknown) {
  // Checked before the rate limit, so other sites cannot spend a user's budget.
  return rejectCrossOrigin(request) ?? startConnect(request, context);
}
