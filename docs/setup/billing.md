# Billing with Stripe (test mode)

FolioMind sells one plan, **FolioMind Pro**, as a monthly subscription through Stripe's hosted Checkout and Customer Portal. Billing stays in Stripe's **test mode**: no real card is ever charged. Going live is a separate, deliberate step, described in [stripe-go-live.md](stripe-go-live.md).

## How it works

1. **Upgrade to Pro** (Pricing or Billing) calls `POST /api/billing/checkout`. The server checks the account (active, verified email, not already Pro), takes the price from its own allowlist (`STRIPE_PRO_MONTHLY_PRICE_ID`) and creates, or reuses, the user's one Stripe customer and one open Checkout Session. Simultaneous clicks produce one session.
2. Stripe hosts the payment. On return, **Billing and usage** shows **Payment pending** and polls every 3 seconds. Visiting the success URL grants nothing.
3. Stripe calls `POST /api/webhooks/stripe`. The route verifies the signature on the raw body (a missing or forged signature gets a 400), then stores the event and its outbox entry in one transaction and answers 2xx. A repeat delivery is a harmless 2xx. A database failure is a 503, and Stripe retries.
4. Worker A's **sync-stripe** fetches the customer's current subscriptions and invoices from Stripe and rebuilds the local copy. It works one customer at a time, so a late or repeated event can't overwrite newer state. Pro starts, the session snapshot is dropped, and the Billing page notices.
5. **reconcile-billing** runs hourly (`BILLING_RECONCILE_CRON`, default `0 * * * *`). It settles Checkout Sessions open for over an hour and re-syncs customers with unfinished events or stale subscriptions.
6. **Manage billing** opens Stripe's Customer Portal for invoices, the payment method and cancellation at the end of the period.

**Who gets Pro.** A subscription to the configured price with status `active`, `trialing` or `past_due`, paid through a date still in the future. "Paid through" is the end of the latest paid invoice's period. After cancelling at period end, Pro lasts until that date. After a failed renewal it lasts only until the paid-through date; there's no extra grace period. `incomplete`, `incomplete_expired`, `unpaid`, `paused` and `canceled` never start Pro. When a payment recovers, Pro returns.

**Allowances.** Free periods are UTC calendar months. Pro periods follow the Stripe billing period. On upgrade, what was used this month carries into the first Pro period, so limits can't be reset by switching plans. Work made on Pro stays readable and downloadable after a downgrade.

## One-time setup

1. **Test secret key.** In the Stripe Dashboard, in test mode (sandbox), open **Developers → API keys** and copy the secret key (`sk_test_…`). Add it as `STRIPE_SECRET_KEY` to `apps/web/.env.local` and `apps/worker-ingestion/.env`. Never paste it into chat or commit it.
2. **Create the Stripe objects.** From the repo root:

   ```bash
   pnpm stripe:setup -- --webhook-url https://folio-mind-two.vercel.app/api/webhooks/stripe
   ```

   The script refuses live keys. It finds or creates the product "FolioMind Pro" and a monthly price (USD 9.00, a placeholder; change it with `--amount 900 --currency usd`). It configures the Customer Portal (invoices, payment method, cancellation at period end) and registers the webhook endpoint for the 10 events FolioMind handles. It prints `STRIPE_PRO_MONTHLY_PRICE_ID=price_…` and writes the new endpoint's signing secret to the git-ignored `.env.stripe-webhook`, never to the terminal. Running it again changes nothing that is already right.

3. **Local env files.** Add `STRIPE_PRO_MONTHLY_PRICE_ID` to both env files. Then run `pnpm db:seed`, which records the price on the `pro` plan row (it never clears one already set).
4. **Vercel.** Under **Settings → Environment Variables**, set these for Production and Preview:

   | Variable                      | Value                                                        |
   | ----------------------------- | ------------------------------------------------------------ |
   | `STRIPE_SECRET_KEY`           | The same `sk_test_…` key                                     |
   | `STRIPE_WEBHOOK_SECRET`       | The value from `.env.stripe-webhook` (then delete that file) |
   | `STRIPE_PRO_MONTHLY_PRICE_ID` | The `price_…` ID                                             |

   **Set these before deploying the billing code.** Production and preview builds stop when one is missing.

5. **Inngest.** After the deploy, Worker A lists two more functions, `sync-stripe` and `reconcile-billing`. If the integration doesn't sync on its own, run `curl -X PUT https://folio-mind-two.vercel.app/api/inngest`.

## Testing locally

The Stripe CLI is installed with winget, at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe\stripe.exe` (open a new terminal for it to be on `PATH`).

1. Start the app and the Inngest dev server ([background-jobs.md](background-jobs.md)).
2. Forward Stripe's events to the local route:

   ```bash
   stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:3000/api/webhooks/stripe
   ```

   It prints a local signing secret (`whsec_…`). Put that one, not the Vercel one, in `apps/web/.env.local` as `STRIPE_WEBHOOK_SECRET`, and restart the app.

3. Use Stripe's test cards on the real hosted Checkout, with any future expiry date and any CVC:

   | Card                  | Journey                                                         |
   | --------------------- | --------------------------------------------------------------- |
   | `4242 4242 4242 4242` | Payment succeeds: Payment pending, then Pro                     |
   | `4000 0025 0000 3155` | Needs authentication: complete or fail the challenge            |
   | `4000 0000 0000 0002` | Declined: stays Free, no subscription                           |
   | `4000 0000 0000 0341` | Saves, but every later charge fails: use it for renewal failure |

4. **Renewal failure and recovery.** Renewals happen a month later, so use a Stripe **test clock**: a customer on the clock, a subscription to the Pro price with `metadata[userId]` set to the FolioMind user's ID, then the customer's card swapped for one that fails (`pm_card_chargeCustomerFail`) and the clock advanced past the period end. The renewal fails: Billing shows the failed payment, a notification arrives, and Pro lasts until the paid-through date. Attach `pm_card_visa`, pay the open invoice, and Pro is confirmed again. (`billing_cycle_anchor=now` is refused on the pinned API version, so a clock is the way.)
5. **Cancel at period end.** In the Portal, cancel. Billing shows "Cancels on …", and Pro stays until then.
6. **Concurrent Checkout.** Click **Upgrade to Pro** in two tabs. Both open the same session.
7. **Authentication required.** Pay with `4000 0025 0000 3155` and choose **Complete** on Stripe's test challenge; **Fail** leaves the account on Free. Check this one by hand: Stripe's challenge doesn't respond reliably to automation.
8. **Signature checks.** `stripe trigger` events come from customers FolioMind doesn't know, so they're recorded and then ignored. A request without a valid `Stripe-Signature` gets a 400 and changes nothing.

The success and decline journeys from step 3, and steps 4–6, are automated in `apps/web/e2e/billing.spec.ts`, along with opening the Portal. It's opt-in, because it needs the key, `stripe listen` and Worker A:

```bash
E2E_STRIPE=1 PLAYWRIGHT_CHANNEL=chrome pnpm e2e e2e/billing.spec.ts --project=desktop
```

It cleans up after itself: it cancels its subscriptions and deletes its test clocks.

Other automated coverage: `packages/domain/src/billing/billing.test.ts` (entitlements, Checkout, deduplication, deletion), `packages/workflows/src/functions/ingestion/billing.test.ts` (sync-stripe and reconcile-billing) and `apps/web/app/api/webhooks/stripe/route.test.ts` (signatures).

Checkout always charges the configured price in its own currency (`adaptive_pricing` is off), so it shows the same "$9.00" as the Pricing page wherever the buyer is.

## When something looks wrong

- **Payment pending doesn't clear.** In Stripe, open **Developers → Webhooks → the endpoint → Event deliveries** and check for 2xx responses. In Inngest, open the `sync-stripe` runs. If neither shows a problem, the hourly `reconcile-billing` re-syncs the customer. The webhook event's status is in `webhook_events`: `received`, `processed`, `ignored` or `failed`.
- **The webhook gets 400s.** The signing secret doesn't match the endpoint. Each endpoint, and each `stripe listen` session, has its own secret.
- **The webhook gets 503s.** Either billing isn't configured on that deployment (a Stripe variable is missing) or the database refused the write. Stripe keeps retrying for up to three days.
- **"Pro checkout opens once pricing is final."** The deployment has no `STRIPE_PRO_MONTHLY_PRICE_ID`, or Stripe couldn't return the price.
