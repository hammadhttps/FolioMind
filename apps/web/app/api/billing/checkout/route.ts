import { BILLING_REFUSALS, checkoutRequestSchema } from "@foliomind/contracts";
import { startCheckout } from "@foliomind/domain";
import {
  billingConfigured,
  billingUrls,
  getBillingGateway,
  proPriceId,
} from "@/lib/billing/server";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

import { errorFields, logEvent } from "@/lib/log";
/**
 * `POST /api/billing/checkout` (Section 10 "Checkout flow" steps 1–4). The
 * browser names a plan; the price comes from the server's allowlist. Returns
 * Stripe's hosted Checkout URL. Pro is never granted here: only the webhook
 * sync does that. Limited to 5 per 10 minutes, refused when Redis can't answer.
 */
export const POST = withRateLimit("billingSession", async (request: Request) => {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  const user = await getFreshUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to upgrade.");
  const priceId = proPriceId();
  if (!billingConfigured() || !priceId) {
    return apiError(503, "not_configured", BILLING_REFUSALS.not_configured);
  }
  const body = checkoutRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "invalid", "Choose a plan to upgrade to.");

  try {
    const result = await startCheckout(getDb(), getBillingGateway(), {
      userId: user.id,
      priceId,
      ...billingUrls(),
    });
    if (!result.ok) {
      const status =
        result.code === "account_inactive" || result.code === "email_unverified" ? 403 : 409;
      return apiError(status, result.code, BILLING_REFUSALS[result.code]);
    }
    return Response.json({ url: result.url }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logEvent("error", "billing.checkout_failed", errorFields(error));
    return apiError(502, "provider_unavailable", BILLING_REFUSALS.provider_unavailable);
  }
});
