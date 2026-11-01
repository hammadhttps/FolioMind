import { signInProviderSchema } from "@foliomind/contracts";
import { isRecentAuthentication, unlinkIdentity } from "@foliomind/domain";
import { IDENTITY_MESSAGES } from "@/lib/account/identity-messages";
import { auth0IdentityAdmin } from "@/lib/auth/identity-admin";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

type Context = { params: Promise<{ provider: string }> };

const STATUS = {
  reauthentication_required: 403,
  last_method: 409,
  primary_method: 409,
  not_linked: 404,
} as const;

/**
 * `DELETE /api/account/identities/:provider` — disconnect a sign-in method
 * (Section 22 rule 6): needs a recent sign-in and another remaining method.
 */
const disconnect = withRateLimit(
  "accountSecurity",
  async (_request: Request, { params }: Context) => {
    // A privileged mutation: re-read Postgres rather than trust the cached snapshot.
    const user = await getFreshUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to manage sign-in methods.");
    if (user.status !== "active")
      return apiError(403, "account_inactive", IDENTITY_MESSAGES.link_failed);

    const provider = signInProviderSchema.safeParse((await params).provider);
    if (!provider.success) return apiError(404, "not_linked", IDENTITY_MESSAGES.not_linked);

    try {
      const outcome = await unlinkIdentity(getDb(), auth0IdentityAdmin, {
        user,
        provider: provider.data,
        recentlyAuthenticated: isRecentAuthentication(user.signedInAt),
      });
      if (outcome.ok) return Response.json({ ok: true });
      const status = STATUS[outcome.code as keyof typeof STATUS] ?? 409;
      return apiError(status, outcome.code, IDENTITY_MESSAGES[outcome.code]);
    } catch {
      console.error(JSON.stringify({ event: "identity.unlink_failed" }));
      return apiError(502, "link_failed", "We couldn't disconnect that method. Please try again.");
    }
  },
);

export async function DELETE(request: Request, context: Context) {
  return rejectCrossOrigin(request) ?? disconnect(request, context);
}
