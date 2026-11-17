/**
 * `pnpm stripe:setup -- --webhook-url <https url> [--amount 900] [--currency usd]`
 *
 * Creates (or finds) FolioMind's Stripe objects in TEST mode (blueprint
 * Section 10): the "FolioMind Pro" product, one monthly price, the Customer
 * Portal settings (invoices, payment methods, cancel at period end) and a
 * webhook endpoint for the events FolioMind handles. Safe to run again: every
 * object is looked up first. Refuses live keys.
 *
 * Reads STRIPE_SECRET_KEY from the environment. Prints object IDs only; a new
 * webhook endpoint's signing secret is written to the git-ignored
 * `.env.stripe-webhook` for copying into Vercel, never printed.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { STRIPE_WEBHOOK_EVENTS } from "@foliomind/contracts";
import { createStripe, isStripeTestKey } from "@foliomind/domain";

type StripeClient = ReturnType<typeof createStripe>;
type PortalFeatures = NonNullable<
  Parameters<StripeClient["billingPortal"]["configurations"]["create"]>[0]
>["features"];
type EnabledEvents = Parameters<StripeClient["webhookEndpoints"]["create"]>[0]["enabled_events"];

const LOOKUP_KEY = "foliomind_pro_monthly";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Set STRIPE_SECRET_KEY (a sk_test_ key) first.");
  if (!isStripeTestKey(key))
    throw new Error("Refusing: this script only runs with a test-mode key.");
  const webhookUrl = arg("webhook-url");
  const amount = Number(arg("amount", "900"));
  const currency = (arg("currency", "usd") ?? "usd").toLowerCase();
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error("--amount is in minor units, e.g. 900");
  const stripe = createStripe(key);

  // Product.
  const products = await stripe.products.search({
    query: "metadata['foliomind_plan']:'pro' AND active:'true'",
  });
  const product =
    products.data[0] ??
    (await stripe.products.create(
      {
        name: "FolioMind Pro",
        description: "More sources, questions and projects in FolioMind.",
        metadata: { foliomind_plan: "pro" },
      },
      { idempotencyKey: "foliomind-setup-product-pro" },
    ));
  console.log(`product  ${product.id}${products.data[0] ? " (existing)" : " (created)"}`);

  // Price: one monthly price, found by its lookup key.
  const prices = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
  let price = prices.data[0];
  if (price && (price.unit_amount !== amount || price.currency !== currency)) {
    // A different placeholder: a new price takes over the lookup key.
    price = undefined;
  }
  price ??= await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency,
    recurring: { interval: "month" },
    lookup_key: LOOKUP_KEY,
    transfer_lookup_key: true,
    nickname: "FolioMind Pro monthly (test placeholder)",
  });
  console.log(`price    ${price.id} (${price.unit_amount} ${price.currency} / month)`);

  // Customer Portal: invoices, payment methods and cancellation at period end only.
  const features: PortalFeatures = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
  };
  const configurations = await stripe.billingPortal.configurations.list({ limit: 20 });
  const current = configurations.data.find((configuration) => configuration.is_default);
  const portal = current
    ? await stripe.billingPortal.configurations.update(current.id, {
        features,
        business_profile: { headline: "Manage your FolioMind Pro subscription" },
      })
    : await stripe.billingPortal.configurations.create({
        features,
        business_profile: { headline: "Manage your FolioMind Pro subscription" },
      });
  console.log(`portal   ${portal.id}${current ? " (updated default)" : " (created)"}`);

  // Webhook endpoint for the deployed site.
  if (webhookUrl) {
    if (!/^https:\/\//.test(webhookUrl)) throw new Error("--webhook-url must be https");
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const existing = endpoints.data.find((endpoint) => endpoint.url === webhookUrl);
    const enabledEvents = [...STRIPE_WEBHOOK_EVENTS] as EnabledEvents;
    if (existing) {
      await stripe.webhookEndpoints.update(existing.id, { enabled_events: enabledEvents });
      console.log(`webhook  ${existing.id} (existing; its signing secret is unchanged)`);
    } else {
      const endpoint = await stripe.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: enabledEvents,
        description: "FolioMind billing sync",
      });
      const file = path.resolve(import.meta.dirname, "..", ".env.stripe-webhook");
      writeFileSync(
        file,
        `# Signing secret for ${webhookUrl} (test mode). Copy into Vercel, then delete this file.\nSTRIPE_WEBHOOK_SECRET=${endpoint.secret}\n`,
        { mode: 0o600 },
      );
      console.log(
        `webhook  ${endpoint.id} (created; signing secret written to .env.stripe-webhook)`,
      );
    }
  }
  console.log(`\nSTRIPE_PRO_MONTHLY_PRICE_ID=${price.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
