import { BILLING_REFUSALS } from "@foliomind/contracts";
import { openPortal } from "@foliomind/domain";
import { billingConfigured, billingUrls, getBillingGateway } from "@/lib/billing/server";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

import { logEvent } from "@/lib/log";
/**
 * `POST /api/billing/portal` (Section 10 step 5): a Customer Portal session
 * for the signed-in user's own stored customer, returning to Billing. A
 * customer ID from the browser is never accepted.
 */
export const POST = withRateLimit("billingSession", async (request: Request) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const user = await getFreshUser();
  if (!user || user.status !== "active") {
    return apiError(401, "unauthenticated", "Sign in to manage billing.");
  }
  if (!billingConfigured()) {
    return apiError(503, "not_configured", BILLING_REFUSALS.not_configured);
  }
  try {
    const result = await openPortal(getDb(), getBillingGateway(), {
      userId: user.id,
      returnUrl: billingUrls().portalReturnUrl,
    });
    if (!result.ok) return apiError(404, result.code, BILLING_REFUSALS.no_customer);
    return Response.json({ url: result.url }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logEvent("error", "billing.portal_failed", { name: (error as Error)?.name });
    return apiError(502, "provider_unavailable", BILLING_REFUSALS.provider_unavailable);
  }
});
