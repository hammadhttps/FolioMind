import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasConnectedWorker,
  hasTestAuth,
  seedPublisher,
  setRole,
  signInAs,
  uploadThingToken,
} from "./auth";

/*
 * The real book path (Section 25 `bookSourcePdf` and `coverImage`): a
 * publisher uploads a PDF and a cover through UploadThing, Worker A ingests
 * it, the publisher submits, an admin approves, and another reader opens it in
 * the Reader through the authorized file route. Needs a real UploadThing token,
 * Jina and Worker A, like the processing spec.
 */

const FIXTURE = path.resolve(__dirname, "fixtures/field-notes.pdf");
// A 1×1 PNG.
const COVER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const created: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  test.skip(!uploadThingToken(), "Set UPLOADTHING_TOKEN in apps/web/.env.local.");
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
  test.skip(!(await hasConnectedWorker()), "Start Worker A against the Inngest Dev Server.");
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

test("a publisher uploads a real PDF and cover; once approved a reader opens it", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const tag = randomUUID().slice(0, 8);
  const title = `Field notes ${tag}`;
  const publisher = await createTestUser();
  const admin = await createTestUser();
  const reader = await createTestUser();
  created.push(publisher.id, admin.id, reader.id);
  await seedPublisher(publisher.id, { slug: `upload-${tag}`, name: `Upload Press ${tag}` });
  await setRole(admin.id, "admin");

  const publisherContext = await browser.newContext();
  await signInAs(publisherContext, publisher);
  const page = await publisherContext.newPage();
  await page.goto("/dashboard/publishing");
  await page.getByRole("button", { name: "Submit a publication" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.locator('input[type="file"]').setInputFiles(FIXTURE);
  await dialog.getByRole("button", { name: "Add book" }).click();
  await expect(page).toHaveURL(/\?book=/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // The editor follows ingestion until the PDF is ready, without a manual reload.
  await expect(page.getByText(/Ready · \d+ pages/)).toBeVisible({ timeout: 150_000 });

  // A cover, also through UploadThing.
  await page.locator('input[type="file"][accept*="image"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: COVER,
  });
  await page.getByRole("button", { name: "Upload cover" }).click();
  await expect(page.getByText("Cover added.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Remove cover" })).toBeVisible();

  await page.getByLabel("Author", { exact: true }).fill("Ada Rivers");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Field notes from a river restoration project, uploaded by the end-to-end tests.");
  await page.getByLabel("Research", { exact: true }).check();
  await page
    .getByLabel("License statement")
    .fill("Test content uploaded by FolioMind's end-to-end tests; no rights are granted.");
  await page.getByLabel(/I hold the rights to share this book/).check();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Waiting for review", { exact: true })).toBeVisible();
  const bookId = new URL(page.url()).searchParams.get("book")!;

  // The admin opens the submitted PDF through the moderation route, then approves.
  const adminContext = await browser.newContext();
  await signInAs(adminContext, admin);
  const moderator = await adminContext.newPage();
  await moderator.goto("/admin/moderation");
  await moderator
    .getByRole("row")
    .filter({ hasText: title })
    .getByRole("button", { name: "Review" })
    .click();
  const href = await moderator.getByRole("link", { name: "Open the PDF" }).getAttribute("href");
  const pdf = await moderator.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await moderator.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await moderator
    .getByRole("dialog")
    .filter({ hasText: "Approve this submission?" })
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(moderator.getByText("Approved. It's live in the library.")).toBeVisible();

  // Readers can't open the moderation route.
  const readerContext = await browser.newContext();
  await signInAs(readerContext, reader);
  const readerPage = await readerContext.newPage();
  expect((await readerPage.request.get(href!)).status()).toBe(403);

  // A reader sees the uploaded cover and reads the book in the Reader.
  await readerPage.goto(`/books/${bookId}`);
  await expect(
    readerPage.getByRole("img", { name: `Cover of ${title} by Ada Rivers` }),
  ).toBeVisible();
  await readerPage.getByRole("link", { name: "Start reading" }).click();
  await expect(readerPage.getByRole("heading", { name: title })).toBeVisible();
  // The PDF streams through the authorized file route and PDF.js renders its text.
  await expect(
    readerPage.locator('.page[data-page-number="1"] .textLayer span').first(),
  ).toBeAttached({ timeout: 60_000 });
});
