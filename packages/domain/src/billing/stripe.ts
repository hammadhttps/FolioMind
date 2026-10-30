import Stripe from "stripe";

/**
 * Stripe API version pinned explicitly (blueprint Section 10). It matches the
 * version stripe-node 23.x is generated for; upgrade both together.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

export function createStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
    appInfo: { name: "FolioMind" },
  });
}

/** Local development and CI must only ever use test-mode keys. */
export function isStripeTestKey(secretKey: string): boolean {
  return /^(sk|rk)_test_/.test(secretKey);
}
