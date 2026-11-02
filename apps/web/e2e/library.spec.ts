import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasTestAuth,
  seedDocument,
  signInAs,
} from "./auth";
import { expectNoHorizontalOverflow, watchConsole } from "./helpers";

/*
 * My Library and document access (Phase 5) with seeded documents. Reading real
 * pages and uploading need UploadThing private files: see reader.spec.ts.
 */

const created: string[] = [];

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

async function libraryUser() {
  const user = await createTestUser();
  created.push(user.id);
  const rivers = await seedDocument(user.id, "Rivers of the North", "queued");
  const margins = await seedDocument(user.id, "Margins and Grids", "ready");
  const scanned = await seedDocument(user.id, "Scanned Handout", "failed");
  return { user, rivers, margins, scanned };
}

const card = (page: Page, title: string) =>
  page.getByRole("article").filter({ has: page.getByRole("link", { name: title, exact: true }) });

test("My Library lists the user's documents with status, search and filters in the URL", async ({
  context,
  page,
}) => {
  const { user } = await libraryUser();
  await signInAs(context, user);
  const errors = watchConsole(page);

  await page.goto("/dashboard/library");
  await expect(card(page, "Rivers of the North").getByText("Processing")).toBeVisible();
  await expect(card(page, "Margins and Grids").getByText("Ready")).toBeVisible();
  await expect(card(page, "Scanned Handout").getByText("Needs attention")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByLabel("Search your library").fill("margins");
  await expect(page).toHaveURL(/q=margins/);
  await expect(card(page, "Margins and Grids")).toBeVisible();
  await expect(card(page, "Rivers of the North")).toHaveCount(0);

  await page.getByLabel("Search your library").fill("");
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Processing" }).click();
  await expect(page).toHaveURL(/status=processing/);
  await expect(card(page, "Rivers of the North")).toBeVisible();
  await expect(card(page, "Margins and Grids")).toHaveCount(0);

  // A shared or reloaded URL keeps the filters.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveText(/Processing/);
  await expect(card(page, "Margins and Grids")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("collections group documents and survive their deletion without losing documents", async ({
  context,
  page,
}) => {
  const { user } = await libraryUser();
  await signInAs(context, user);
  await page.goto("/dashboard/library");

  await page.getByRole("button", { name: "New collection" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Thesis");
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByText("Collection created.")).toBeVisible();

  await card(page, "Rivers of the North")
    .getByRole("button", { name: "Actions for Rivers of the North" })
    .click();
  await page.getByRole("menuitemcheckbox", { name: "Thesis" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Thesis" })).toBeChecked();
  await page.keyboard.press("Escape");

  await page
    .getByRole("group", { name: "Collections" })
    .getByRole("button", { name: /Thesis/ })
    .click();
  await expect(page).toHaveURL(/collection=/);
  await expect(card(page, "Rivers of the North")).toBeVisible();
  await expect(card(page, "Margins and Grids")).toHaveCount(0);

  // Names are unique per user.
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("thesis");
  await page.getByRole("dialog").getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByText("You already have a collection with that name.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await page
    .getByRole("group", { name: "Collections" })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete collection" }).click();
  await expect(page.getByText("Its documents are still in your library.")).toBeVisible();
  await expect(card(page, "Rivers of the North")).toBeVisible();
  await expect(card(page, "Margins and Grids")).toBeVisible();
});

test("rename and delete; deletion stops access at once", async ({ context, page }) => {
  const { user, rivers } = await libraryUser();
  await signInAs(context, user);
  await page.goto("/dashboard/library");

  await card(page, "Rivers of the North")
    .getByRole("button", { name: "Actions for Rivers of the North" })
    .click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("Rivers, Revised");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(card(page, "Rivers, Revised")).toBeVisible();

  expect((await page.request.get(`/api/documents/${rivers.documentId}/access`)).status()).toBe(200);

  await card(page, "Rivers, Revised")
    .getByRole("button", { name: "Actions for Rivers, Revised" })
    .click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Document deleted.")).toBeVisible();
  await expect(card(page, "Rivers, Revised")).toHaveCount(0);

  expect((await page.request.get(`/api/documents/${rivers.documentId}/access`)).status()).toBe(404);
  await page.goto(`/read/${rivers.documentId}`);
  await expect(page.getByRole("heading", { name: "This document isn't available." })).toBeVisible();
});

test("another user cannot open a document or its access URL", async ({
  browser,
  context,
  page,
}) => {
  const { user, rivers } = await libraryUser();
  await signInAs(context, user);
  const own = await page.request.get(`/api/documents/${rivers.documentId}/access`);
  expect(own.status()).toBe(200);
  // The storage URL never reaches the browser, only the authorized delivery route.
  expect((await own.json()).url).toBe(`/api/documents/${rivers.documentId}/file`);

  const stranger = await createTestUser();
  created.push(stranger.id);
  const other = await browser.newContext();
  await signInAs(other, stranger);
  const otherPage = await other.newPage();
  expect((await otherPage.request.get(`/api/documents/${rivers.documentId}/access`)).status()).toBe(
    404,
  );
  expect((await otherPage.request.get(`/api/documents/${rivers.documentId}/file`)).status()).toBe(
    404,
  );
  await otherPage.goto(`/read/${rivers.documentId}`);
  await expect(
    otherPage.getByRole("heading", { name: "This document isn't available." }),
  ).toBeVisible();
  await expect(otherPage.getByRole("heading", { name: "Rivers of the North" })).toHaveCount(0);
  await other.close();

  // Signed out: no access URL at all.
  const guest = await browser.newContext();
  expect((await guest.request.get(`/api/documents/${rivers.documentId}/access`)).status()).toBe(
    401,
  );
  expect((await guest.request.get(`/api/documents/${rivers.documentId}/file`)).status()).toBe(401);
  await guest.close();
});

test("the Dashboard shows real counts and the upload action", async ({ context, page }) => {
  const { user } = await libraryUser();
  await signInAs(context, user);
  await page.goto("/dashboard");
  const metrics = page.getByRole("region", { name: "Your activity" });
  await expect(metrics.getByText("Documents in your library")).toBeVisible();
  await expect(metrics).toContainText("3");
  await page.getByRole("button", { name: "Upload PDF" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/You have used .* and 3 of 5 PDFs\./)).toBeVisible();
  // The dropzone's file chooser is reachable from the keyboard.
  await dialog.getByRole("button", { name: "Choose a PDF" }).focus();
  await expect(dialog.getByRole("button", { name: "Choose a PDF" })).toBeFocused();
});
