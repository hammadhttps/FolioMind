import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasTestAuth,
  savedPage,
  signInAs,
  uploadThingToken,
} from "./auth";

/*
 * Upload → My Library → Reader with a real file (Phase 5). Needs the local
 * UploadThing token (development mode delivers the completion callback
 * locally); stored test files are deleted afterwards. The fixture has three
 * pages, and the word "quillwort" appears twice on the third.
 */

const FIXTURE = path.resolve(__dirname, "fixtures/field-notes.pdf");
const created: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The upload and reader flow runs once, at desktop width.",
  );
  test.skip(
    !uploadThingToken(),
    "Set UPLOADTHING_TOKEN in apps/web/.env.local to test real uploads.",
  );
  test.skip(
    !(await hasTestAuth(request)),
    "The server has no Auth0 settings: stop any running dev server so Playwright starts one with the test configuration.",
  );
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

const pageInput = (page: Page) => page.getByLabel("Page number");

/** Selects a whole text-layer run containing `text` on a page, as a reader would. */
async function selectText(page: Page, pageNumber: number, text: string): Promise<string> {
  const run = page
    .locator(`.page[data-page-number="${pageNumber}"] .textLayer span`, { hasText: text })
    .first();
  await expect(run).toBeAttached({ timeout: 15_000 });
  return run.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return node.textContent ?? "";
  });
}

test("upload a PDF, read it, annotate it and come back to the same place", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  // Upload: created only by the server callback, then listed as Processing.
  await page.goto("/dashboard/library");
  await page.getByRole("button", { name: "Upload PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles(FIXTURE);
  await dialog.getByLabel("Title (optional)").fill("Field Notes e2e");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(/PDF added\. You can read it now/)).toBeVisible({ timeout: 90_000 });
  const card = page.getByRole("article").filter({ hasText: "Field Notes e2e" });
  // Processing, or already Ready when a local Worker A picked it up at once.
  await expect(card.getByText(/^(Processing|Ready)$/).first()).toBeVisible();

  // Reader: pages, navigation and find.
  await card.getByRole("link", { name: "Field Notes e2e" }).click();
  await expect(page.getByRole("heading", { name: "Field Notes e2e" })).toBeVisible();
  // The first visit compiles the Reader and the PDF.js worker on the dev server.
  await expect(page.getByText("of 3")).toBeVisible({ timeout: 60_000 });
  // Fit to width: pages never scroll sideways.
  await expect
    .poll(() => page.getByLabel("Document pages").evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
  await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached();
  await page.getByRole("tab", { name: "Ask AI" }).click();
  await expect(
    page
      .getByText(/AI becomes available once your document is processed|Ready for questions/)
      .first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Notes/ }).click();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageInput(page)).toHaveValue("2");
  await page.getByLabel("Document pages").focus();
  await page.keyboard.press("n");
  await expect(pageInput(page)).toHaveValue("3");

  await page.keyboard.press("/");
  await page
    .getByRole("searchbox", { name: "Find in document" })
    .or(page.getByLabel("Find in document").last())
    .fill("quillwort");
  await expect(page.getByText("1 of 2")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close find" }).click();

  // Highlight a passage on page 1 from the selection toolbar.
  await page.getByLabel("Page number").fill("1");
  await page.getByLabel("Page number").press("Enter");
  await expect(pageInput(page)).toHaveValue("1");
  const selected = await selectText(page, 1, "Rivers");
  await page.getByRole("button", { name: "Highlight in mint" }).click();
  const notes = page.getByRole("list", { name: "Bookmarks, highlights and notes" });
  await expect(notes.getByText(selected.trim().slice(0, 20))).toBeVisible();
  await expect(
    page.locator('.page[data-page-number="1"] .fm-highlight[data-color="mint"]').first(),
  ).toBeAttached();

  // A page note and a bookmark.
  await page.getByRole("button", { name: "Add a note", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Note").fill("Compare with the second chapter.");
  await page.getByRole("dialog").getByRole("button", { name: "Save note" }).click();
  await expect(notes.getByText("Compare with the second chapter.")).toBeVisible();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bookmarked", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(notes.getByRole("listitem")).toHaveCount(3);
  await expect(notes.getByRole("listitem").filter({ hasText: /^Pending/ })).toHaveCount(0);

  // Leave on page 2; reopening restores the page and every annotation.
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageInput(page)).toHaveValue("2");
  // The debounced save lands before the reload reads it back.
  await expect.poll(() => savedPage(user.id), { timeout: 20_000 }).toBe(2);
  await page.reload();
  await expect(pageInput(page)).toHaveValue("2", { timeout: 30_000 });
  await expect(
    page.getByRole("list", { name: "Bookmarks, highlights and notes" }).getByRole("listitem"),
  ).toHaveCount(3);

  // Another user cannot read it.
  const documentId = page.url().split("/read/")[1]!;
  const stranger = await createTestUser();
  created.push(stranger.id);
  const other = await browser.newContext();
  await signInAs(other, stranger);
  expect((await other.request.get(`/api/documents/${documentId}/file`)).status()).toBe(404);
  await other.close();

  // The delivery route supports range requests for the owner.
  const ranged = await page.request.get(`/api/documents/${documentId}/file`, {
    headers: { range: "bytes=0-4" },
  });
  expect(ranged.status()).toBe(206);
  expect(await ranged.text()).toBe("%PDF-");

  // Deleting stops access immediately.
  await page.goto("/dashboard/library");
  await page.getByRole("button", { name: "Actions for Field Notes e2e" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Document deleted.")).toBeVisible();
  expect((await page.request.get(`/api/documents/${documentId}/file`)).status()).toBe(404);
});
