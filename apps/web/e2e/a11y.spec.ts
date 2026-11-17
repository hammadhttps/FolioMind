import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasTestAuth,
  setSavedTheme,
  signInAs,
} from "./auth";
import { expectNoHorizontalOverflow } from "./helpers";

/*
 * Accessibility and responsive pass (Section 21 items 5 and 6; Phase 10):
 * WCAG 2.2 AA rules from axe in both themes at desktop and phone widths, and
 * no sideways scrolling at the five reference widths. axe checks contrast on
 * the real rendered colours, so both themes matter. Runs once, from the
 * desktop project; it sets its own viewports.
 */

const WIDTHS = [1920, 1440, 900, 390, 320] as const;
const AXE_WIDTHS = [1440, 390] as const;
const THEMES = ["light", "dark"] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PUBLIC_PAGES = ["/", "/library", "/pricing", "/privacy", "/privacy/retention", "/login"];
const SIGNED_IN_PAGES = [
  "/dashboard",
  "/dashboard/library",
  "/dashboard/projects",
  "/dashboard/billing",
  "/dashboard/settings",
  "/dashboard/publishing",
];

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes
      .slice(0, 5)
      .map((node) => `${node.target.join(" ")} :: ${node.html.slice(0, 220)}`),
  }));
}

async function settle(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // Fonts and the theme class are applied before measuring colour contrast.
  await page.evaluate(() => document.fonts.ready);
}

test.describe.configure({ mode: "default" });

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Sets its own viewports.");
  test.setTimeout(240_000);
  // Many fast navigations plus link prefetching: each test is its own client
  // for the 300-a-minute global limit, as each Playwright worker already is.
  await context.setExtraHTTPHeaders({ "x-real-ip": `e2e-a11y-${randomUUID()}` });
});

test.describe("public pages", () => {
  for (const theme of THEMES) {
    test(`meet WCAG 2.2 AA in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      const found: Record<string, unknown> = {};
      for (const width of AXE_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of PUBLIC_PAGES) {
          await page.goto(path);
          await settle(page);
          await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
          const violations = await axeViolations(page);
          if (violations.length > 0) found[`${path} @${width}`] = violations;
        }
      }
      expect(found).toEqual({});
    });
  }

  test("never scroll sideways at the five reference widths", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PUBLIC_PAGES) {
        await page.goto(path);
        await settle(page);
        await expectNoHorizontalOverflow(page);
      }
    }
  });
});

test.describe("signed-in pages", () => {
  const created: string[] = [];

  /** A fresh account per test: a cached snapshot can't carry one test's theme into the next. */
  async function signedIn(context: BrowserContext, theme: (typeof THEMES)[number] = "light") {
    const user = await createTestUser();
    created.push(user.id);
    await setSavedTheme(user.id, theme);
    await signInAs(context, user);
  }

  test.beforeEach(async ({ request }) => {
    test.skip(
      !(await hasTestAuth(request)),
      "The server has no Auth0 settings: stop any running dev server so Playwright starts one with the test configuration.",
    );
  });

  test.afterAll(async () => {
    await deleteTestUsers(created);
    await closeE2eDatabase();
  });

  for (const theme of THEMES) {
    test(`meet WCAG 2.2 AA in the ${theme} theme`, async ({ context, page }) => {
      await signedIn(context, theme);
      const found: Record<string, unknown> = {};
      for (const width of AXE_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of SIGNED_IN_PAGES) {
          await page.goto(path);
          await settle(page);
          await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
          const violations = await axeViolations(page);
          if (violations.length > 0) found[`${path} @${width}`] = violations;
        }
      }
      // The delete-account dialog: focus moves into it and the form is labelled.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/dashboard/settings");
      await expect(page.getByRole("radio", { checked: true })).toBeVisible();
      await page.getByRole("button", { name: "Delete account" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete your account?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(":focus")).toHaveCount(1);
      const dialogViolations = await axeViolations(page);
      if (dialogViolations.length > 0) found["delete dialog"] = dialogViolations;
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name: "Delete account" })).toBeFocused();
      expect(found).toEqual({});
    });
  }

  test("never scroll sideways at the five reference widths", async ({ context, page }) => {
    await signedIn(context);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of SIGNED_IN_PAGES) {
        await page.goto(path);
        await settle(page);
        await expectNoHorizontalOverflow(page);
      }
    }
  });
});
