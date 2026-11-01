import { cacheKeys, createRedis, invalidateUserSnapshot } from "@foliomind/domain";
import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasTestAuth,
  promoteWithScript,
  savedTheme,
  setStatus,
  signInAs,
} from "./auth";
import { expectNoHorizontalOverflow, watchConsole } from "./helpers";

/*
 * Phase 4 identity flows with a real local account and a minted session
 * (e2e/auth.ts). Needs the Compose stack (`pnpm stack:up`, `pnpm db:setup`) and
 * a server started by Playwright, which runs with the test Auth0 settings.
 */

const created: string[] = [];

/** The theme radio reflects next-themes only after hydration, so forms are live once it is checked. */
async function waitForSettings(page: Page) {
  await expect(page.getByRole("radio", { checked: true })).toBeVisible();
}

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Account flows run once, at desktop width.");
  test.skip(
    !(await hasTestAuth(request)),
    "The server has no Auth0 settings: stop any running dev server so Playwright starts one with the test configuration.",
  );
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

test("a signed-in user sees their name in the workspace shell", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  const errors = watchConsole(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { level: 1, name: `Welcome back, ${user.firstName}.` }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("display name and theme are saved to the account", async ({ browser, context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  await page.goto("/dashboard/settings");
  await waitForSettings(page);
  const name = page.getByLabel("Display name");
  await expect(name).toHaveValue(user.displayName);
  await name.fill("Renamed Reader");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => savedTheme(user.id)).toBe("dark");

  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Renamed Reader");
  await expect(page.locator("html")).toHaveClass(/dark/);

  // A fresh browser has no stored theme: the account's preference applies.
  const other = await browser.newContext();
  await signInAs(other, user);
  const otherPage = await other.newPage();
  await otherPage.goto("/dashboard");
  await expect(otherPage.locator("html")).toHaveClass(/dark/);
  await expect(
    otherPage.getByRole("heading", { level: 1, name: "Welcome back, Renamed." }),
  ).toBeVisible();
  await other.close();
});

test("validation keeps the entered name and explains the limit", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  await page.goto("/dashboard/settings");
  await waitForSettings(page);
  const name = page.getByLabel("Display name");
  await name.fill("   ");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Enter a display name.")).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
});

test("an admin promoted by the script sees the Admin group", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  promoteWithScript(user.email);
  await signInAs(context, user);

  await page.goto("/dashboard");
  await expect(page.locator('a[href="/admin/moderation"]').first()).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Admin access required.")).toHaveCount(0);
});

test("a reader cannot use the admin pages", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href="/admin/moderation"]')).toHaveCount(0);
  for (const path of ["/admin", "/admin/moderation"]) {
    await page.goto(path);
    await expect(page.getByText("Admin access required.")).toBeVisible();
  }
});

test("suspension signs the user out at once with a clear message", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // What Phase 9's admin action does: change the status and drop the cached snapshot.
  await setStatus(user.id, "suspended");
  await invalidateUserSnapshot(
    createRedis({ url: "http://localhost:8079", token: "foliomind-local-dev-token", retries: 0 }),
    cacheKeys("development"),
    user.id,
  );

  await page.goto("/dashboard/library");
  await expect(page).toHaveURL(/\/login\?auth_error=suspended/);
  await expect(
    page.getByRole("alert").filter({ hasText: "This account is suspended" }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("Sign-in methods show the primary method and offer the other", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  await page.goto("/dashboard/settings");
  const methods = page.getByRole("list").filter({ hasText: "GitHub" });
  const google = methods.getByRole("listitem").filter({ hasText: "Google" });
  await expect(google.getByText("Connected")).toBeVisible();
  await expect(google.getByText("Primary")).toBeVisible();
  await expect(google.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  await expect(
    methods.getByRole("listitem").filter({ hasText: "GitHub" }).getByRole("button", {
      name: "Connect GitHub",
    }),
  ).toBeEnabled();
});

test("sign-in method endpoints refuse other origins and guests", async ({ request }) => {
  const crossSite = await request.post("/api/account/identities", {
    headers: { origin: "https://evil.example" },
    data: { connection: "github" },
  });
  expect(crossSite.status()).toBe(403);
  expect((await crossSite.json()).error.code).toBe("bad_origin");

  const guest = await request.delete("/api/account/identities/github", {
    headers: { origin: "http://localhost:3000" },
  });
  expect(guest.status()).toBe(401);
});
