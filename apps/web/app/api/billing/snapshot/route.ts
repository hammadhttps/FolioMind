import { billingSnapshot } from "@foliomind/domain";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

/**
 * `GET /api/billing/snapshot`: the signed-in user's billing state, polled by
 * Billing while a payment is pending until the webhook sync confirms it.
 */
export const GET = withRateLimit("authenticatedRead", async () => {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") {
    return apiError(401, "unauthenticated", "Sign in first.");
  }
  return Response.json(await billingSnapshot(getDb(), user.id), {
    headers: { "cache-control": "private, no-store" },
  });
});
