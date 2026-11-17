import "server-only";
import { proPriceSchema, type ProPrice } from "@foliomind/contracts";
import { cached, cacheKey, createStripeGateway, type BillingGateway } from "@foliomind/domain";
import { appEnv, env } from "@/env";
import { getRequestRedis, getStripe } from "@/lib/clients";

/*
 * Billing configuration for the web app (blueprint Section 10). Stripe stays
 * in test mode (user decision); the Pro price comes from the server's
 * allowlist (`STRIPE_PRO_MONTHLY_PRICE_ID`), never from the browser.
 */

let gateway: BillingGateway | undefined;

export function billingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRO_MONTHLY_PRICE_ID);
}

export function getBillingGateway(): BillingGateway {
  gateway ??= createStripeGateway(getStripe());
  return gateway;
}

export function proPriceId(): string | null {
  return env.STRIPE_PRO_MONTHLY_PRICE_ID ?? null;
}

/** True while Stripe runs with test keys: Pricing and Billing say no real charges are made. */
export function isSandbox(): boolean {
  return (
    !env.STRIPE_SECRET_KEY ||
    env.STRIPE_SECRET_KEY.startsWith("sk_test_") ||
    env.STRIPE_SECRET_KEY.startsWith("rk_test_")
  );
}

/**
 * FolioMind's own address for Stripe's return URLs (Section 10: fixed,
 * allowlisted). Production uses its stable domain, previews their own URL.
 */
export function appOrigin(): string {
  if (env.APP_BASE_URL) return new URL(env.APP_BASE_URL).origin;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && production) return `https://${production}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const billingUrls = () => {
  const origin = appOrigin();
  return {
    successUrl: `${origin}/dashboard/billing?checkout=returned`,
    cancelUrl: `${origin}/pricing?checkout=cancelled`,
    portalReturnUrl: `${origin}/dashboard/billing`,
  };
};

/** The Pro price as Stripe has it, cached for an hour; null when billing isn't set up. */
export async function getProPrice(): Promise<ProPrice | null> {
  const priceId = proPriceId();
  if (!billingConfigured() || !priceId) return null;
  try {
    return await cached(getRequestRedis(), {
      key: cacheKey(appEnv, "billing", "price", priceId),
      ttlSeconds: 60 * 60,
      schema: proPriceSchema,
      load: async () => {
        const price = await getBillingGateway().retrievePrice(priceId);
        return price.active
          ? {
              id: price.id,
              unitAmount: price.unitAmount,
              currency: price.currency,
              interval: price.interval,
              livemode: price.livemode,
            }
          : null;
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "billing.price_unavailable", name: (error as Error)?.name }),
    );
    return null;
  }
}

export function formatPrice(price: ProPrice): string {
  const amount = new Intl.NumberFormat("en", {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
  }).format(price.unitAmount / 100);
  return `${amount} / ${price.interval}`;
}
