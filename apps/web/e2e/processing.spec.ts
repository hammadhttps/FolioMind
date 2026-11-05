import path from "node:path";
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
 * Phase 6: upload → Processing with phases → Ready → "Your PDF is ready to
 * read." in the bell → the Reader's ready state. Needs the local stack, a
 * real UploadThing token, Jina, and Worker A connected to the Inngest Dev
 * Server (`pnpm dev` or the worker alone).
 */

const FIXTURE = path.resolve(__dirname, "fixtures/field-notes.pdf");
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

test("an uploaded PDF is processed, announced and ready for questions", async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);

  await page.goto("/dashboard/library");
  await page.getByRole("button", { name: "Upload PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles(FIXTURE);
  await dialog.getByLabel("Title (optional)").fill("Processing e2e");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(/PDF added\. You can read it now/)).toBeVisible({ timeout: 90_000 });

  // The card follows the job until it is Ready, without a manual reload.
  const card = page.getByRole("article").filter({ hasText: "Processing e2e" });
  await expect(card.getByText("Ready", { exact: true })).toBeVisible({ timeout: 150_000 });

  // The bell has an unread notice that opens the Reader.
  const bell = page.getByRole("button", { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible({ timeout: 70_000 });
  await bell.click();
  const notice = page.getByRole("list", { name: "Notifications" }).getByRole("listitem").first();
  await expect(notice.getByText("Your PDF is ready to read.")).toBeVisible();
  await expect(notice.getByText(/“Processing e2e” is ready/)).toBeVisible();
  await notice.getByRole("link", { name: /Your PDF is ready to read/ }).click();

  await expect(page.getByRole("heading", { name: "Processing e2e" })).toBeVisible();
  // A ready document opens on the chat.
  await expect(
    page.getByRole("tabpanel", { name: "Ask AI" }).getByLabel("Your question"),
  ).toBeEnabled();

  // Read state sticks: the bell no longer reports unread notices.
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible({
    timeout: 70_000,
  });
});
