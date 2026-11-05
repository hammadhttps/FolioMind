import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasAiKeys,
  hasConnectedWorker,
  hasTestAuth,
  signInAs,
  uploadThingToken,
} from "./auth";

/*
 * Phase 7 end to end, with nothing faked: real PDFs through UploadThing and
 * Worker A, real Jina and real Gemini. Needs the local stack, the API keys in
 * apps/web/.env.local and Worker A connected to the Inngest Dev Server. Answers
 * are checked for what the documents say, and never for exact wording.
 */

const HARBOR = path.resolve(__dirname, "fixtures/harbor-plan.pdf");
const HEAT = path.resolve(__dirname, "fixtures/heat-study.pdf");
const created: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  test.skip(!uploadThingToken(), "Set UPLOADTHING_TOKEN in apps/web/.env.local.");
  test.skip(!hasAiKeys(), "Set GEMINI_API_KEY and JINA_API_KEY in apps/web/.env.local.");
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
  test.skip(!(await hasConnectedWorker()), "Start Worker A against the Inngest Dev Server.");
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

async function signedIn(context: BrowserContext) {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);
  return user;
}

/** Uploads a real PDF through the dialog and waits until Worker A has made it Ready. */
async function uploadAndWaitReady(page: Page, file: string, title: string) {
  await page.goto("/dashboard/library");
  await page.getByRole("button", { name: "Upload PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await dialog.getByLabel("Title (optional)").fill(title);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText(/PDF added\. You can read it now/)).toBeVisible({ timeout: 90_000 });
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card.getByText("Ready", { exact: true })).toBeVisible({ timeout: 150_000 });
  return card;
}

const pageInput = (page: Page) => page.getByLabel("Page number");

/** Selects a whole text-layer run containing `text` on a page, as a reader would. */
async function selectText(page: Page, pageNumber: number, text: string) {
  const run = page
    .locator(`.page[data-page-number="${pageNumber}"] .textLayer span`, { hasText: text })
    .first();
  await expect(run).toBeAttached({ timeout: 15_000 });
  await run.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function ask(chat: ReturnType<Page["getByRole"]>, question: string) {
  await chat.getByLabel("Your question").fill(question);
  await chat.getByRole("button", { name: "Send question" }).click();
}

test("the Reader streams a cited answer, opens the cited page and keeps the thread", async ({
  context,
  page,
}) => {
  test.setTimeout(420_000);
  await signedIn(context);
  const card = await uploadAndWaitReady(page, HARBOR, "Harbor plan e2e");
  await card.getByRole("link", { name: "Harbor plan e2e" }).click();
  await expect(page.getByRole("heading", { name: "Harbor plan e2e" })).toBeVisible();
  await expect(page.getByText("of 8")).toBeVisible({ timeout: 60_000 });

  // A ready document opens on the chat, with suggested questions and the allowance.
  const chat = page.getByRole("tabpanel", { name: "Ask AI" });
  await expect(
    chat.getByRole("list", { name: "Suggested questions" }).getByRole("button"),
  ).toHaveCount(3);
  await expect(chat.getByText("30 of 30 questions left this month")).toBeVisible();

  await ask(
    chat,
    "How much is the Tamsin Tidal Barrier budgeted to cost, and when does it finish?",
  );
  // Stop appears while the answer is arriving.
  await expect(chat.getByRole("button", { name: "Stop generating" })).toBeVisible();

  // The figures come from page 3 of this invented document.
  const sources = chat.getByRole("list", { name: "Sources" }).last();
  await expect(sources.getByRole("button").first()).toBeVisible({ timeout: 90_000 });
  await expect(chat.getByRole("log")).toContainText("412");
  await expect(chat.getByRole("log")).toContainText("2031");
  await expect(chat.getByText("29 of 30 questions left this month")).toBeVisible();
  await expect(chat.getByRole("button", { name: "Send question" })).toBeVisible();

  // Opening the citation moves the viewer to the page the chunk starts on.
  await expect(pageInput(page)).toHaveValue("1");
  await sources.getByRole("button", { name: /Harbor plan e2e, page 3/ }).click();
  await expect(pageInput(page)).toHaveValue("3");
  await expect(page.locator('.page[data-page-number="3"] .textLayer')).toContainText(
    "412 million",
    {
      timeout: 30_000,
    },
  );

  // A snippet is available to read beside the chip.
  await chat.getByText("Show source text").last().click();
  await expect(chat.getByText(/412 million dollars/).last()).toBeVisible();

  // The support check marks the citation without blocking anything.
  await expect(chat.getByText(/Not clearly supported/)).toHaveCount(0);

  // Reloading restores the thread from the server, with its citations.
  await page.reload();
  const restored = page.getByRole("tabpanel", { name: "Ask AI" });
  await expect(restored.getByRole("log")).toContainText("412", { timeout: 45_000 });
  await expect(
    restored.getByRole("list", { name: "Sources" }).getByRole("button").first(),
  ).toBeVisible();

  // A question this document can't answer is admitted, not answered.
  await ask(restored, "How long should I bake a sourdough loaf at 230 degrees?");
  await expect(restored.getByText("Not found in your sources")).toBeVisible({ timeout: 60_000 });
  await expect(restored.getByRole("log")).toContainText(/couldn't find/);
  await expect(
    restored.getByRole("link", { name: /Add sources in a research workspace/ }),
  ).toBeVisible();

  // Save to notes puts the answer on the cited page's notes.
  await restored.getByRole("button", { name: "Save to notes" }).first().click();
  await expect(page.getByText(/Saved to your notes on page 3/)).toBeVisible();
  await expect(restored.getByRole("button", { name: "Saved to notes" })).toBeVisible();
  await page.getByRole("tab", { name: /Notes/ }).click();
  const notes = page.getByRole("tabpanel", { name: /Notes/ });
  await expect(notes.getByText(/\(pp?\. 3/)).toBeVisible();
  await page.getByRole("tab", { name: "Ask AI" }).click();

  // Threads: a new one is empty, the old one is still there and can be renamed.
  await restored.getByRole("button", { name: "New conversation" }).click();
  await expect(restored.getByRole("list", { name: "Suggested questions" })).toBeVisible();
  await restored.getByRole("button", { name: /^Conversations\./ }).click();
  await page.getByRole("menuitemradio", { name: /Tamsin Tidal Barrier/ }).click();
  await expect(restored.getByRole("log")).toContainText("412");
  await restored.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Barrier cost");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(restored.getByRole("button", { name: /Current: Barrier cost/ })).toBeVisible();

  // Ask about selection: the selected words are the focus, and their page stays on the question.
  await page.getByLabel("Page number").fill("3");
  await page.getByLabel("Page number").press("Enter");
  await expect(pageInput(page)).toHaveValue("3");
  await selectText(page, 3, "412");
  await page.getByRole("button", { name: "Ask about selection" }).click();
  await expect(restored.getByText("Selected on page 3:")).toBeVisible();
  await restored.getByLabel("Your question").fill("What does this figure refer to?");
  await restored.getByRole("button", { name: "Send question" }).click();
  await expect(restored.getByText("Selected on page 3:")).toHaveCount(0);
  await expect(restored.getByText("Page 3:", { exact: false })).toBeVisible();
  await expect(restored.getByRole("list", { name: "Sources" }).last()).toBeVisible({
    timeout: 90_000,
  });
  await expect(restored.getByRole("button", { name: "Send question" })).toBeVisible();
});

test("a citation's deep link opens its page in the Reader", async ({ context, page }) => {
  test.setTimeout(300_000);
  await signedIn(context);
  const card = await uploadAndWaitReady(page, HARBOR, "Harbor link e2e");
  await card.getByRole("link", { name: "Harbor link e2e" }).click();
  await expect(page.getByText("of 8")).toBeVisible({ timeout: 60_000 });
  const documentId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/read/${documentId}?page=5`);
  await expect(pageInput(page)).toHaveValue("5", { timeout: 60_000 });
});

test("a workspace compares two sources, cites both, saves to notes and opens the Reader", async ({
  context,
  page,
}) => {
  test.setTimeout(480_000);
  await signedIn(context);
  await uploadAndWaitReady(page, HARBOR, "Harbor flood plan");
  await uploadAndWaitReady(page, HEAT, "Port Alder heat study");

  await page.goto("/dashboard?tab=research");
  await page.getByRole("button", { name: "New workspace" }).first().click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill("Coastal comparison");
  await form.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Coastal comparison", level: 1 })).toBeVisible({
    timeout: 45_000,
  });

  await page.getByRole("button", { name: "Add sources" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Add Harbor flood plan" }).click();
  await expect(picker.getByRole("button", { name: "Add Port Alder heat study" })).toBeEnabled();
  await picker.getByRole("button", { name: "Add Port Alder heat study" }).click();
  await expect(picker.getByText("This workspace has its 2 sources.")).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("list", { name: "Workspace sources" }).getByRole("listitem"),
  ).toHaveCount(2);

  // Empty-state prompts invite key ideas, connections and practical application.
  const chat = page.getByRole("region", { name: "Ask across your sources" });
  await expect(chat.getByRole("button", { name: /key ideas/ })).toBeEnabled();
  await expect(chat.getByRole("button", { name: /agree or disagree/ })).toBeEnabled();
  await expect(chat.getByRole("button", { name: /apply these ideas/ })).toBeEnabled();

  await ask(chat, "Compare how the flood plan and the heat programme are funded.");
  const sources = chat.getByRole("list", { name: "Sources" }).last();
  await expect(sources.getByRole("button").first()).toBeVisible({ timeout: 90_000 });
  await expect(sources.getByRole("button", { name: /Harbor flood plan/ }).first()).toBeVisible();
  await expect(
    sources.getByRole("button", { name: /Port Alder heat study/ }).first(),
  ).toBeVisible();
  // Figures from each document.
  await expect(chat.getByRole("log")).toContainText(/58|hotel/i);
  await expect(chat.getByRole("log")).toContainText(/690|55|federal/i);

  // Save to notes keeps the answer and its sources.
  await chat.getByRole("button", { name: "Save to notes" }).first().click();
  await expect(page.getByText("Saved to your notes.")).toBeVisible();
  const noteSources = page.getByRole("list", { name: "Sources for this note" });
  await expect(
    noteSources.getByRole("button", { name: /Harbor flood plan/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note 1" })).toContainText(/58|hotel/i, {
    timeout: 30_000,
  });

  // After a reload the note and thread are still there; the note's chip opens the Reader.
  await page.reload();
  const chip = page
    .getByRole("list", { name: "Sources for this note" })
    .getByRole("button", { name: /Port Alder heat study/ })
    .first();
  await expect(chip).toBeVisible({ timeout: 45_000 });
  await chip.click();
  await page.waitForURL(/\/read\/[0-9a-f-]{36}\?page=\d+/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Port Alder heat study" })).toBeVisible();
  const expectedPage = new URL(page.url()).searchParams.get("page")!;
  await expect(pageInput(page)).toHaveValue(expectedPage, { timeout: 60_000 });
});
