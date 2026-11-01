import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, isProductionServer, watchConsole } from "./helpers";

/*
 * Route sweep (Phase 3 acceptance): every template and supporting route at the
 * desktop (1440px) and mobile (390px) projects, with no horizontal overflow and
 * no console errors.
 */

const PUBLIC_ROUTES = [
  { path: "/", heading: /Read deeply\./ },
  { path: "/library", heading: "A world of ideas, within reach." },
  { path: "/pricing", heading: "Plans for every kind of reader." },
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Use" },
  { path: "/login", heading: "Welcome to FolioMind" },
] as const;

// Catalog IDs resolve from Phase 9; until then they are honest 404s.
const NOT_FOUND_ROUTES = [
  { path: "/books/unknown-book", title: "This book isn't available." },
  { path: "/publishers/unknown-publisher", title: "We couldn't find that publisher." },
  { path: "/this-page-does-not-exist", title: "We couldn't find that page." },
] as const;

const SIGNED_IN_ROUTES = [
  "/dashboard",
  "/dashboard?tab=research",
  "/dashboard/library",
  "/read/example-document",
  "/dashboard/research/example-workspace",
  "/dashboard/projects",
  "/dashboard/projects/example-project",
  "/dashboard/publishing",
  "/dashboard/settings",
  "/dashboard/billing",
  "/admin",
  "/admin/moderation",
] as const;

for (const route of PUBLIC_ROUTES) {
  test(`public ${route.path} renders its heading without overflow or errors`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const route of NOT_FOUND_ROUTES) {
  test(`unknown ${route.path} shows a not-found state`, async ({ page }) => {
    const errors = watchConsole(page, { allowNotFound: true });
    await page.goto(route.path);
    await expect(page.getByText(route.title)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test.describe("guests on signed-in routes", () => {
  for (const path of [
    "/dashboard",
    "/dashboard/library?type=saved",
    "/read/example-document",
    "/admin",
  ]) {
    test(`${path} redirects to FolioMind's sign-in page and keeps the return path`, async ({
      request,
    }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const location = new URL(response.headers().location ?? "", "http://localhost");
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("returnTo")).toBe(path);
    });
  }
});

test.describe("Auth0's hosted login page is never used", () => {
  for (const path of [
    "/auth/login",
    "/auth/login?returnTo=%2Fdashboard%2Flibrary",
    "/auth/login?connection=Username-Password-Authentication",
    "/auth/login?connection=email&returnTo=%2Fadmin",
  ]) {
    test(`${path} goes to /login instead`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const location = new URL(response.headers().location ?? "", "http://localhost");
      expect(location.pathname).toBe("/login");
      const expected =
        new URL(path, "http://localhost").searchParams.get("returnTo") ?? "/dashboard";
      expect(location.searchParams.get("returnTo")).toBe(expected);
    });
  }

  test("unused Auth0 SDK routes are closed", async ({ request }) => {
    expect((await request.post("/auth/passwordless/start", { data: {} })).status()).toBe(404);
    expect((await request.post("/auth/passwordless/verify", { data: {} })).status()).toBe(404);
    expect((await request.get("/auth/access-token")).status()).toBe(404);
    expect((await request.get("/auth/mfa/authenticators")).status()).toBe(404);
    expect((await request.post("/auth/login")).status()).toBe(404);
  });
});

test.describe("signed-in routes", () => {
  const storageState = process.env.E2E_STORAGE_STATE;
  test.skip(
    !storageState,
    "Set E2E_STORAGE_STATE to a Playwright storage-state file saved after signing in through Auth0 to test signed-in routes.",
  );
  test.use({ storageState: storageState ?? undefined });

  for (const path of SIGNED_IN_ROUTES) {
    test(`${path} renders in the workspace shell`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("development gallery", () => {
  test("/dev/ui is not available in production builds", async ({ request }) => {
    test.skip(!isProductionServer, "Runs against the production server in CI.");
    expect((await request.get("/dev/ui")).status()).toBe(404);
  });

  // Signed-in screens rendered in the shell with a sample user (development only).
  const PREVIEWS = [
    "dashboard",
    "my-library",
    "reader",
    "research-workspace",
    "my-projects-sample",
    "pdf-studio",
    "publishing",
    "settings",
    "billing",
    "admin-overview",
    "moderation",
    "book-details",
    "publisher-profile",
  ];
  for (const slug of PREVIEWS) {
    test(`preview ${slug} has no overflow or errors`, async ({ page }) => {
      test.skip(isProductionServer, "Screen previews exist only on the development server.");
      const errors = watchConsole(page);
      await page.goto(`/dev/ui/screens/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }
});
