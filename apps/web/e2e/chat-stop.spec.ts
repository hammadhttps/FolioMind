import { documentByKey } from "@foliomind/ai/eval";
import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasAiKeys,
  hasTestAuth,
  seedChunks,
  seedDocument,
  signInAs,
} from "./auth";

/*
 * Stop on a real stream, against real Jina and Gemini. The document is seeded
 * with searchable text rather than uploaded, so this also runs on `next start`,
 * where UploadThing can't call back to localhost.
 */

const created: string[] = [];
const QUESTION = "Summarize every part of this plan in detail, section by section.";

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  test.skip(!hasAiKeys(), "Set GEMINI_API_KEY and JINA_API_KEY in apps/web/.env.local.");
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

const chatOf = (page: Page) => page.getByRole("tabpanel", { name: "Ask AI" });

/** The reservation is released just after the request ends, so this can take a moment. */
const expectNothingCharged = (page: Page) =>
  expect(async () => {
    await page.reload();
    await expect(chatOf(page).getByText("30 of 30 questions left this month")).toBeVisible({
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000 });

async function openDocument(context: Parameters<typeof signInAs>[0], page: Page) {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);
  const { documentId } = await seedDocument(user.id, "Harbor stop e2e", "ready");
  const { pages } = documentByKey("harbor-plan");
  await seedChunks(
    documentId,
    pages.map((item) => item.paragraphs.join("\n\n")),
  );
  await page.goto(`/read/${documentId}`);
  await expect(chatOf(page).getByText("30 of 30 questions left this month")).toBeVisible({
    timeout: 60_000,
  });
}

test("Stop before the first word charges nothing and gives the question back", async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  await openDocument(context, page);
  const chat = chatOf(page);
  await chat.getByLabel("Your question").fill(QUESTION);
  await chat.getByRole("button", { name: "Send question" }).click();
  await chat.getByRole("button", { name: "Stop generating" }).click();

  // Stop must not send it again: this click once did, because the button became Send under it.
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/chat")) sent.push(request.method());
  });
  await expect(chat.getByLabel("Your question")).toHaveValue(QUESTION, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(sent).toEqual([]);
  await expect(chat.getByRole("button", { name: "Send question" })).toBeEnabled();
  await expectNothingCharged(page);
});

test("Stop once words are arriving keeps them, marked, and charges nothing", async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  await openDocument(context, page);
  const chat = chatOf(page);
  await chat.getByLabel("Your question").fill(QUESTION);
  await chat.getByRole("button", { name: "Send question" }).click();

  const log = chat.getByRole("log");
  await expect
    .poll(async () => (await log.innerText()).length, { timeout: 90_000, intervals: [50] })
    .toBeGreaterThan(QUESTION.length + 30);
  const stopped = await chat
    .getByRole("button", { name: "Stop generating" })
    .click({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  test.skip(!stopped, "The answer finished before Stop could be pressed.");

  await expect(chat.getByText(/Stopped\. This question wasn't counted\./)).toBeVisible();
  await expect(chat.getByRole("button", { name: "Send question" })).toBeVisible({
    timeout: 30_000,
  });
  await expectNothingCharged(page);
  await expect(chatOf(page).getByText(/Stopped\. This question wasn't counted\./)).toBeVisible();
});
