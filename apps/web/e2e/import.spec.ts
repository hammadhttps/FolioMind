import { expect, test } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasConnectedWorker,
  hasTestAuth,
  signInAs,
  uploadThingToken,
} from "./auth";

/*
 * Web article import (Section 27). The address rules are checked on the
 * server whatever the browser sends; a real import (Jina Reader → Browserless
 * → UploadThing → ingestion) runs when E2E_IMPORT_URL names a public article
 * and Worker A is connected locally.
 */

const created: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

test("the server refuses local, private and FolioMind addresses", async ({ browser }) => {
  const cases: [string, RegExp][] = [
    ["http://localhost:3000/secret", /private or local network/],
    ["http://127.0.0.1/admin", /IP address/],
    ["http://[::1]/", /IP address/],
    ["http://169.254.169.254/latest/meta-data", /IP address/],
    ["http://2130706433/", /IP address/],
    ["https://intranet.corp/page", /private or local network/],
    ["https://user:pass@example.com/", /user name or password/],
    ["ftp://example.com/file", /http:\/\/ or https:\/\//],
    ["https://folio-mind-two.vercel.app/dashboard", /FolioMind page/],
  ];
  // The import route allows 5 requests per 10 minutes per user, refused ones included.
  for (let start = 0; start < cases.length; start += 4) {
    const context = await browser.newContext();
    const user = await createTestUser();
    created.push(user.id);
    await signInAs(context, user);
    const page = await context.newPage();
    await page.goto("/dashboard/library");
    const origin = new URL(page.url()).origin;
    for (const [url, message] of cases.slice(start, start + 4)) {
      const response = await page.request.post("/api/imports/url", {
        data: { url, rightsConfirmed: true },
        headers: { origin },
      });
      expect(response.status(), url).toBe(400);
      expect(JSON.stringify(await response.json()), url).toMatch(message);
    }
    if (start === 0) {
      // Another origin cannot start an import with the user's cookie.
      const crossSite = await page.request.post("/api/imports/url", {
        data: { url: "https://example.com/article", rightsConfirmed: true },
        headers: { origin: "https://evil.example" },
      });
      expect(crossSite.status()).toBe(403);
    }
    await context.close();
  }
});

test("the form explains the rules, and the rights box is required", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);
  await page.goto("/dashboard/library");

  // The rights confirmation is required on the server too.
  const unconfirmed = await page.request.post("/api/imports/url", {
    data: { url: "https://example.com/article", rightsConfirmed: false },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(unconfirmed.status()).toBe(400);

  await page.getByRole("button", { name: "Upload PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Import from URL" }).click();
  await dialog.getByLabel("Article URL").fill("http://localhost/page");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByText(/private or local network/)).toBeVisible();
  await expect(dialog.getByText(/Confirm that you may save this page/)).toBeVisible();
});

test("a public article becomes a private, ready document", async ({ context, page }) => {
  const url = process.env.E2E_IMPORT_URL;
  test.skip(!url, "Set E2E_IMPORT_URL to a public article to test a real import.");
  test.skip(!uploadThingToken(), "Set UPLOADTHING_TOKEN in apps/web/.env.local.");
  test.skip(!(await hasConnectedWorker()), "Start Worker A against the Inngest Dev Server.");
  test.setTimeout(300_000);

  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);
  await page.goto("/dashboard/library");
  await page.getByRole("button", { name: "Upload PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Import from URL" }).click();
  await dialog.getByLabel("Article URL").fill(url!);
  await dialog.getByLabel("I may save this page for personal study.").check();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/Importing the article/)).toBeVisible({ timeout: 30_000 });

  const card = page.getByRole("article").filter({ hasText: "Imported" }).first();
  await expect(card.getByText(/^(Processing|Ready)$/).first()).toBeVisible();
  await expect(card.getByText("Ready", { exact: true })).toBeVisible({ timeout: 240_000 });

  // The snapshot opens in the Reader with its own pages; the menu links to the original.
  await card.getByRole("button", { name: /^Actions for / }).click();
  await expect(page.getByRole("menuitem", { name: "Open original page" })).toHaveAttribute(
    "href",
    url!,
  );
  await page.getByRole("menuitem", { name: "Open in reader" }).click();
  await expect(page.getByText(/of \d+/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".textLayer").first()).toContainText(
    /Imported from the web for personal study/,
    {
      timeout: 30_000,
    },
  );
});
