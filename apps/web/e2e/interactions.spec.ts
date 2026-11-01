import { expect, test } from "@playwright/test";
import { isProductionServer } from "./helpers";

test("the skip link is the first focusable element", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});

test("the sign-in dialog sends Google and GitHub straight to their connections", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Get started" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Welcome to FolioMind" })).toBeVisible();

  const href = async (name: RegExp) =>
    new URL((await dialog.getByRole("link", { name }).getAttribute("href")) ?? "", "http://x");
  const google = await href(/Continue with Google/);
  const github = await href(/Continue with GitHub/);

  expect([google.pathname, github.pathname]).toEqual(["/auth/login", "/auth/login"]);
  expect(google.searchParams.get("connection")).toBe("google-oauth2");
  expect(github.searchParams.get("connection")).toBe("github");
  expect(google.searchParams.get("prompt")).toBe("select_account");
  expect(google.searchParams.get("returnTo")).toBe("/dashboard");

  // Email sign-in happens in FolioMind's own form, not on Auth0's page.
  await expect(dialog.getByLabel("Email address")).toBeVisible();
  for (const link of await dialog.getByRole("link").all()) {
    const target = (await link.getAttribute("href")) ?? "";
    if (target.startsWith("/auth/login"))
      expect(target).toMatch(/connection=(google-oauth2|github)/);
  }

  for (const control of [
    dialog.getByRole("link", { name: /Continue with Google/ }),
    dialog.getByRole("link", { name: /Continue with GitHub/ }),
    dialog.getByRole("button", { name: "Email me a sign-in code" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the sign-in page validates email and explains when email sign-in is unavailable", async ({
  page,
}) => {
  await page.goto("/login?returnTo=%2Fdashboard%2Flibrary");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to FolioMind" })).toBeVisible();
  const google = page.getByRole("link", { name: /Continue with Google/ });
  await expect(google).toHaveAttribute(
    "href",
    "/auth/login?connection=google-oauth2&prompt=select_account&returnTo=%2Fdashboard%2Flibrary",
  );

  const email = page.getByLabel("Email address");
  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  // No Auth0 keys in local and CI runs, so the server reports email sign-in as unavailable.
  test.skip(Boolean(process.env.E2E_AUTH0_CONFIGURED), "Auth0 is configured for this run.");
  await email.fill("reader@example.com");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByText(/Email sign-in isn't available right now/)).toBeVisible();
});

test("the sign-in page shows callback errors from the URL", async ({ page }) => {
  await page.goto("/login?auth_error=cancelled");
  // Scoped to <main>: Next.js's route announcer also has role="alert".
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Sign-in was cancelled.");
});

test("Explore keeps category filters in the URL", async ({ page }) => {
  await page.goto("/library");
  const design = page.getByRole("button", { name: "Design", exact: true });
  await design.click();
  await expect(page).toHaveURL(/category=design/);
  await expect(design).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Try a broader search or clear your filters.")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test.describe("workspace shell (development preview)", () => {
  test.skip(isProductionServer, "Uses the development-only screen previews.");

  test("Ctrl+K opens page navigation", async ({ page, isMobile }) => {
    test.skip(isMobile, "Keyboard shortcut is a desktop affordance.");
    await page.goto("/dev/ui/screens/dashboard", { waitUntil: "networkidle" });
    const input = page.getByPlaceholder("Go to a page…");
    // The page is server-rendered: retry until hydration has attached the shortcut.
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(input).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await input.fill("projects");
    await expect(page.getByRole("option", { name: "My Projects" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("the theme menu switches to dark mode", async ({ page, isMobile }) => {
    test.skip(isMobile, "The topbar theme control is hidden at 460px and below (Settings has it).");
    await page.goto("/dev/ui/screens/dashboard");
    await page.getByRole("button", { name: "Change appearance" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("the mobile drawer opens and closes with Escape", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The drawer replaces the sidebar at 760px and below.");
    await page.goto("/dev/ui/screens/dashboard");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("link", { name: "My Library" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});
