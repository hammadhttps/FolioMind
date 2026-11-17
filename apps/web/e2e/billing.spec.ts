import { createStripe } from "@foliomind/domain";
import { expect, test, type Page } from "@playwright/test";
import {
  billingOf,
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasConnectedWorker,
  hasTestAuth,
  planOf,
  signInAs,
  stripePriceId,
  stripeTestKey,
  type TestUser,
} from "./auth";

/*
 * Billing in Stripe's test mode (Section 10 "Testing and go-live"): real hosted
 * Checkout with Stripe's test cards, webhooks forwarded by `stripe listen`, and
 * Worker A's sync-stripe. Opt-in (`E2E_STRIPE=1`), because it needs the test
 * key, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` with its
 * secret in apps/web/.env.local, and Worker A connected. See docs/setup/billing.md.
 * Renewal and cancellation are driven through Stripe's API, as time would.
 */

const key = stripeTestKey();
const priceId = process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? stripePriceId();
const created: string[] = [];
/** Test clocks to delete afterwards; deleting one removes its customers. */
const clocks: string[] = [];
const SYNC_TIMEOUT = 90_000;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Billing journeys run once, at desktop width.");
  test.skip(process.env.E2E_STRIPE !== "1", "Set E2E_STRIPE=1 with stripe listen running.");
  test.skip(!key, "Set a Stripe test key (sk_test_…) in apps/web/.env.local.");
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
  test.skip(!(await hasConnectedWorker()), "Start Worker A against the Inngest Dev Server.");
  test.setTimeout(240_000);
});

test.afterAll(async () => {
  if (key) {
    // Nothing keeps billing in the test account after the run.
    const stripe = createStripe(key);
    for (const id of created) {
      const { subscriptionId } = await billingOf(id);
      if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId).catch(() => {});
    }
    for (const clock of clocks) await stripe.testHelpers.testClocks.del(clock).catch(() => {});
  }
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

async function newUser(): Promise<TestUser> {
  const user = await createTestUser();
  created.push(user.id);
  return user;
}

/** Fills Stripe's hosted Checkout with a test card and submits it. */
async function payOnCheckout(page: Page, card: string) {
  // Stripe's frames can hold up the load event; the price check below waits for the page.
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000, waitUntil: "commit" });
  // The price is the one the Pricing page shows, in USD (no local-currency conversion).
  await expect(page.getByText("$9.00").first()).toBeVisible({ timeout: 30_000 });
  // The payment form is a Stripe Elements frame; the email comes from the customer.
  const form = page.locator("iframe[name^='__privateStripeFrame']").first().contentFrame();
  await form.getByRole("button", { name: "Card", exact: true }).click();
  await form.getByRole("textbox", { name: "Card number" }).fill(card);
  await form.getByRole("textbox", { name: "Expiration (MM/YY)" }).fill("12 / 34");
  await form.getByRole("textbox", { name: "Security code" }).fill("123");
  await form.getByRole("textbox", { name: "Name on card" }).fill("Tess Tester");
  await form.getByRole("combobox", { name: "Country" }).selectOption({ label: "United States" });
  const zip = form.getByRole("textbox", { name: /ZIP/ });
  if (await zip.isVisible().catch(() => false)) await zip.fill("10001");
  await form.getByRole("button", { name: "Subscribe" }).click();
}

async function startUpgrade(page: Page) {
  await page.goto("/pricing");
  await expect(page.getByText("Test mode: no real charges")).toBeVisible();
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
}

async function expectPlan(userId: string, plan: "free" | "pro") {
  await expect.poll(() => planOf(userId), { timeout: SYNC_TIMEOUT }).toBe(plan);
}

let subscriber: TestUser;

test("a test card upgrades to Pro after Stripe confirms, never before", async ({
  context,
  page,
}) => {
  subscriber = await newUser();
  await signInAs(context, subscriber);
  await startUpgrade(page);
  await payOnCheckout(page, "4242 4242 4242 4242");

  await page.waitForURL(/\/dashboard\/billing\?checkout=returned/, { timeout: 60_000 });
  // Back from Stripe: Pro only once the webhook sync confirms it.
  await expect(page.getByText("FolioMind Pro", { exact: true }).first()).toBeVisible({
    timeout: SYNC_TIMEOUT,
  });
  await expectPlan(subscriber.id, "pro");
  await expect(page.getByRole("link", { name: /View invoice/ }).first()).toBeVisible({
    timeout: SYNC_TIMEOUT,
  });
  await expect(page.getByText("You're on FolioMind Pro")).toBeVisible();
  expect((await billingOf(subscriber.id)).status).toBe("active");

  // A second purchase is refused: one subscription per account.
  const again = await page.request.post("/api/billing/checkout", {
    data: { plan: "pro" },
    headers: { origin: "http://localhost:3000" },
  });
  expect(again.status()).toBe(409);
});

test("Manage billing opens Stripe's portal for the account's own customer", async ({
  context,
  page,
}) => {
  await signInAs(context, subscriber);
  await page.goto("/dashboard/billing");
  await page.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });
});

test("a failed renewal keeps paid access until paid-through and warns; paying restores it", async ({
  context,
  page,
}) => {
  // Renewals happen a month later, so this account's subscription lives on a
  // Stripe test clock that is moved past the period end. It's created through
  // the API with the user's ID in its metadata, as Checkout would.
  const stripe = createStripe(key!);
  const user = await newUser();
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: "FolioMind e2e renewal",
  });
  clocks.push(clock.id);
  const customer = await stripe.customers.create({
    email: user.email,
    test_clock: clock.id,
    metadata: { userId: user.id },
    payment_method: "pm_card_visa",
    invoice_settings: { default_payment_method: "pm_card_visa" },
  });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    metadata: { userId: user.id },
  });
  await expectPlan(user.id, "pro");

  // Every later charge fails (Stripe's pm_card_chargeCustomerFail), then a month passes.
  const failing = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: failing.id },
  });
  const periodEnd = subscription.items.data[0]!.current_period_end;
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: periodEnd + 3600 });
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(clock.id)).status, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe("ready");

  await signInAs(context, user);
  await expect(async () => {
    await page.goto("/dashboard/billing");
    await expect(page.getByText("Your last payment didn't go through")).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: SYNC_TIMEOUT });
  // The first period is paid through a date still ahead in real time: Pro stays, no grace beyond it.
  await expectPlan(user.id, "pro");
  expect((await billingOf(user.id)).status).toBe("past_due");

  // A working card and the open invoice paid: the issue clears.
  const working = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: working.id },
  });
  const open = await stripe.invoices.list({ subscription: subscription.id, status: "open" });
  for (const invoice of open.data) {
    await stripe.invoices.pay(invoice.id!, { payment_method: working.id });
  }
  await expect
    .poll(async () => (await billingOf(user.id)).status, { timeout: SYNC_TIMEOUT })
    .toBe("active");
  await page.goto("/dashboard/billing");
  await expect(page.getByText("Your last payment didn't go through")).toHaveCount(0);
  await expectPlan(user.id, "pro");
});

test("cancelling at period end keeps Pro until the paid period ends", async ({ context, page }) => {
  const stripe = createStripe(key!);
  const { subscriptionId } = await billingOf(subscriber.id);
  await stripe.subscriptions.update(subscriptionId!, { cancel_at_period_end: true });
  await expect
    .poll(async () => (await billingOf(subscriber.id)).cancelAtPeriodEnd, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe(true);
  await signInAs(context, subscriber);
  await page.goto("/dashboard/billing");
  await expect(page.getByText(/^Cancels on /)).toBeVisible();
  await expectPlan(subscriber.id, "pro");

  // Ended in Stripe: Free again, and the work stays.
  await stripe.subscriptions.cancel(subscriptionId!);
  await expectPlan(subscriber.id, "free");
});

test("a declined card leaves the account on Free", async ({ context, page }) => {
  const user = await newUser();
  await signInAs(context, user);
  await startUpgrade(page);
  await payOnCheckout(page, "4000 0000 0000 0002");
  // Stripe shows the refusal inside its payment form, one of several Stripe frames by now.
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          const text = await frame
            .locator("body")
            .innerText()
            .catch(() => "");
          if (text.includes("Your card was declined")) return true;
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(page.url()).toContain("checkout.stripe.com");
  expect(await planOf(user.id)).toBe("free");
});

// Stripe's hosted 3D Secure test challenge doesn't respond reliably to automation
// (its Complete button slides in late, and repeated automated sessions start to
// stall). Checked by hand; see docs/setup/billing.md "Testing locally".
test.fixme("a card that needs authentication upgrades once the bank confirms", async ({
  context,
  page,
}) => {
  const user = await newUser();
  await signInAs(context, user);
  await startUpgrade(page);
  await payOnCheckout(page, "4000 0025 0000 3155");
  // Stripe's test 3D Secure challenge: its own frame, with Complete and Fail buttons.
  await expect
    .poll(() => Boolean(page.frame({ name: "stripe-challenge-frame" })), { timeout: 45_000 })
    .toBe(true);
  const complete = page
    .frame({ name: "stripe-challenge-frame" })!
    .locator("#test-source-authorize-3ds");
  // The challenge slides in: click only once the button is really on screen.
  await expect(complete).toBeVisible({ timeout: 30_000 });
  await complete.click();
  await page.waitForURL(/\/dashboard\/billing\?checkout=returned/, { timeout: 60_000 });
  await expectPlan(user.id, "pro");
});

test("two quick clicks open the same Checkout", async ({ context, page }) => {
  const user = await newUser();
  await signInAs(context, user);
  await page.goto("/pricing");
  const post = () =>
    page.request.post("/api/billing/checkout", {
      data: { plan: "pro" },
      headers: { origin: "http://localhost:3000" },
    });
  const [first, second] = await Promise.all([post(), post()]);
  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);
  const urls = [(await first.json()).url, (await second.json()).url];
  expect(urls[0]).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  expect(urls[1]).toBe(urls[0]);
});
