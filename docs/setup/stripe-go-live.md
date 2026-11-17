# Going live with Stripe

> **Not done, and not to be done casually.** FolioMind runs Stripe in test mode.
> These are the steps for the day real payments are allowed. None of them has
> been performed. Each one needs the owner's decision.

## 1. Check that the business can sell

- Stripe accepts live payments only from a supported business in a supported country. Pakistan is not on Stripe's standard list of supported countries. Check what the actual business qualifies for before promising live checkout.
- Use the real business identity and address. Never borrow someone else's merchant account or invent details.
- Finish account activation in the Dashboard (business details, bank account, identity checks).

## 2. Decide the commercial terms

- **Price.** USD 9/month is a placeholder. Set the real price after measuring AI, storage and worker costs (the hardening measurements in `PROGRESS.md`).
- **Allowances.** The Free and Pro limits are provisional. Change them in the `plans` rows (`PLAN_LIMITS` in `@foliomind/contracts`, applied by `pnpm db:seed`). The Pricing page reads them from there.
- **Tax.** Decide whether Stripe Tax applies, then register where needed and enable automatic tax. Checkout and the Portal need tax settings before selling.
- **Legal text.** Replace the draft Terms, Privacy and Data retention pages, settle the open decisions in [data-retention.md](../policies/data-retention.md), and write a refund policy that admins can follow. A refund doesn't cancel by itself.

## 3. Create the live objects

`pnpm stripe:setup` refuses live keys on purpose. Do this in the Dashboard with **live mode** switched on, or review a live variant of the script on that day:

1. Product **FolioMind Pro**, with metadata `foliomind_plan = pro`.
2. One monthly recurring price in the chosen currency, with lookup key `foliomind_pro_monthly`.
3. **Settings → Billing → Customer portal:** invoice history, payment method updates, customer email and address updates, and cancellation **at the end of the billing period** without proration. Turn off plan switching.
4. **Developers → Webhooks → Add endpoint:** `https://<production domain>/api/webhooks/stripe`, with API version `2026-09-30.endive` (the version pinned in `packages/domain/src/billing/stripe.ts`). Select exactly the events in `STRIPE_WEBHOOK_EVENTS` (`packages/contracts/src/billing.ts`):
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` and `invoice.payment_action_required`.
5. Prefer a **restricted key** (`rk_live_…`) over the full secret key. It needs write access to Customers, Checkout Sessions, Customer Portal sessions and Subscriptions, and read access to Invoices and Prices.

If the account's API version has moved past the pinned one, read Stripe's changelog for the subscription, invoice and Checkout fields FolioMind reads before changing the pin. Those are subscription item periods, `invoice.parent.subscription_details` and invoice line periods (`packages/domain/src/billing/gateway.ts`).

## 4. Switch production, and only production

In Vercel, change only the **Production** environment:

| Variable                      | Live value                                       |
| ----------------------------- | ------------------------------------------------ |
| `STRIPE_SECRET_KEY`           | The live restricted key                          |
| `STRIPE_WEBHOOK_SECRET`       | The live endpoint's signing secret               |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | The live price ID                                |
| `APP_BASE_URL`                | The production domain, for the fixed return URLs |

**Preview and development keep test keys** (Section 14: previews never use live billing). The test-mode notices on Pricing and Billing disappear on their own when the key isn't a test key. Then run `pnpm db:seed` against production with the live `STRIPE_PRO_MONTHLY_PRICE_ID`, so the `pro` row names the live price. Redeploy.

Customers, subscriptions and invoices from test mode don't exist in live mode. Before switching, check that no real user depends on a test subscription. Afterwards the hourly reconcile finds those test customers missing; clear their test billing rows in a reviewed migration or script.

## 5. Smoke-test with real money, once

With the owner's approval:

1. Subscribe with a real card at the real price. Check that Payment pending clears, Pro starts and the invoice appears.
2. Open **Manage billing**, cancel at period end, and check the "Cancels on …" state.
3. Refund the charge in the Dashboard, under the refund policy.
4. Check the webhook endpoint's deliveries: every one should be 2xx.

## Rolling back

Put the test-mode values back in Production and redeploy. Live subscriptions keep running in Stripe until cancelled there, so cancel any created during the smoke test.
