import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  currentVersionId,
  deleteTestUsers,
  hasTestAuth,
  projectSourceCount,
  seedDocument,
  signInAs,
  useUpQuestions,
} from "./auth";
import { expectNoHorizontalOverflow } from "./helpers";

/*
 * Phase 7 without AI providers: the Research Workspace itself, the plan's source
 * cap, the question limit and every access refusal around chat. `chat.spec.ts`
 * covers real answers.
 */

const created: string[] = [];

test.beforeEach(async ({ request }) => {
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

async function signedInUser(context: BrowserContext) {
  const user = await createTestUser();
  created.push(user.id);
  await signInAs(context, user);
  return user;
}

const chatBody = (extra: object) => ({
  clientMessageId: randomUUID(),
  message: "What does this say?",
  ...extra,
});

async function createWorkspace(page: Page, name: string) {
  await page.goto("/dashboard?tab=research");
  await page.getByRole("button", { name: "New workspace" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 45_000 });
}

test("chat refuses guests, other origins, bad input and other people's documents", async ({
  context,
  request,
  playwright,
}) => {
  const owner = await createTestUser();
  created.push(owner.id);
  const { documentId } = await seedDocument(owner.id, "Private to its owner", "ready");
  const scope = { kind: "document", documentId };

  // A guest.
  const guest = await request.post("/api/chat", {
    data: chatBody({ scope }),
    headers: { origin: "http://localhost:3000" },
  });
  expect(guest.status()).toBe(401);

  // Another signed-in user: the document reads as missing, and nothing is charged.
  await signedInUser(context);
  const asStranger = context.request;
  const refused = await asStranger.post("/api/chat", {
    data: chatBody({ scope }),
    headers: { origin: "http://localhost:3000" },
  });
  expect(refused.status()).toBe(404);
  expect((await refused.json()).error.code).toBe("not_found");

  const invalid = await asStranger.post("/api/chat", {
    data: { message: "" },
    headers: { origin: "http://localhost:3000" },
  });
  expect(invalid.status()).toBe(400);

  const crossSite = await asStranger.post("/api/chat", {
    data: chatBody({ scope }),
    headers: { origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);

  // Opening a citation checks access again.
  const versionId = await currentVersionId(documentId);
  const opened = await asStranger.get(`/api/sources/${versionId}/open?page=3`);
  expect(await opened.json()).toEqual({ available: false, reason: "removed", documentId: null });
  const guestContext = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  expect((await guestContext.get(`/api/sources/${versionId}/open?page=3`)).status()).toBe(401);
  await guestContext.dispose();
});

test("chat answers Section 23's 429 past 10 questions a minute, for that user only", async ({
  browser,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  await signedInUser(context);
  const post = (request: BrowserContext["request"]) =>
    // The limiter runs before the body is read, so no provider is involved.
    request.post("/api/chat", {
      data: { message: "" },
      headers: { origin: "http://localhost:3000" },
    });

  const responses = [];
  for (let index = 0; index < 11; index += 1) responses.push(await post(context.request));
  expect(responses.slice(0, 10).map((response) => response.status())).toEqual(
    Array.from({ length: 10 }, () => 400),
  );
  const limited = responses[10]!;
  expect(limited.status()).toBe(429);
  expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
  expect(limited.headers()["ratelimit-limit"]).toBe("10");
  expect(limited.headers()["ratelimit-remaining"]).toBe("0");
  expect((await limited.json()).error.code).toBe("rate_limited");

  // Someone else isn't affected.
  const otherContext = await browser.newContext();
  const other = await createTestUser();
  created.push(other.id);
  await signInAs(otherContext, other);
  expect((await post(otherContext.request)).status()).toBe(400);
  await otherContext.close();
});

test("the composer blocks at the Free question limit and explains the allowance", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const { documentId } = await seedDocument(user.id, "Allowance document", "ready");
  await useUpQuestions(user.id, 30);

  await page.goto(`/read/${documentId}`);
  await page.getByRole("tab", { name: "Ask AI" }).click();
  const chat = page.getByRole("tabpanel", { name: "Ask AI" });
  await expect(chat.getByText(/used all 30 questions on the Free plan/)).toBeVisible();
  await expect(chat.getByText(/Pro includes 500 a month/)).toBeVisible();
  await expect(chat.getByRole("link", { name: "Compare plans" })).toHaveAttribute(
    "href",
    "/pricing",
  );
  await expect(chat.getByLabel("Your question")).toBeDisabled();

  // The server refuses too, whatever the page shows.
  const response = await context.request.post("/api/chat", {
    data: chatBody({ scope: { kind: "document", documentId } }),
    headers: { origin: "http://localhost:3000" },
  });
  expect(response.status()).toBe(409);
  const { error } = await response.json();
  expect(error.code).toBe("quota_exceeded");
  expect(error.allowance).toMatchObject({ limit: 30, remaining: 0 });
});

test("a workspace takes ready sources up to the plan's cap, and turns into a project", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  await seedDocument(user.id, "Ready source one", "ready");
  await seedDocument(user.id, "Ready source two", "ready");
  await seedDocument(user.id, "Ready source three", "ready");
  await seedDocument(user.id, "Still processing", "queued");
  const other = await createTestUser();
  created.push(other.id);
  await seedDocument(other.id, "Someone else's document", "ready");

  await createWorkspace(page, "Coastal research");
  await expect(page.getByText("No sources yet.")).toBeVisible();
  await expect(page.getByText("Add ready sources to ask questions across them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn into a PDF" })).toBeDisabled();

  // The picker offers only this user's ready documents.
  await page.getByRole("button", { name: "Add sources" }).click();
  const picker = page.getByRole("dialog");
  const list = picker.getByRole("list", { name: "Ready documents" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(picker.getByText("Still processing")).toHaveCount(0);
  await expect(picker.getByText("Someone else's document")).toHaveCount(0);

  await picker.getByLabel("Search your documents").fill("source two");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await picker.getByRole("button", { name: "Add Ready source two" }).click();
  await expect(page.getByText("Source added.")).toBeVisible();
  await picker.getByLabel("Search your documents").fill("");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await picker.getByRole("button", { name: "Add Ready source one" }).click();

  // At Free's two sources the picker stops offering more.
  await expect(picker.getByText("This workspace has its 2 sources.")).toBeVisible();
  await expect(picker.getByRole("button", { name: "Add Ready source three" })).toBeDisabled();
  await picker.getByRole("button", { name: "Done" }).click();

  const sources = page.getByRole("list", { name: "Workspace sources" });
  await expect(sources.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("2 of 2 on your plan", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add sources" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "compare plans", exact: true })).toBeVisible();

  // Unticking everything stops questions; one tick brings them back.
  await page.getByRole("checkbox", { name: "Use Ready source one for answers" }).click();
  await page.getByRole("checkbox", { name: "Use Ready source two for answers" }).click();
  await expect(page.getByText("Select at least one source to ask a question.")).toBeVisible();
  await expect(page.getByLabel("Your question")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Turn into a PDF" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Use Ready source two for answers" }).click();

  // Turn into a PDF carries the ticked source only.
  await page.getByRole("button", { name: "Turn into a PDF" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  const projectId = new URL(page.url()).pathname.split("/").pop()!;
  expect(await projectSourceCount(projectId)).toBe(1);
});

test("notes save as you write and survive a reload", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  await signedInUser(context);
  await createWorkspace(page, "Notes workspace");

  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.getByRole("button", { name: "New note" }).click();
  const editor = page.getByRole("textbox", { name: "Note 1" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("Barriers need river pumps.");
  await page.getByRole("button", { name: "Bulleted list" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note 1" })).toContainText(
    "Barriers need river pumps.",
    { timeout: 30_000 },
  );

  // The note disappears at once; the reload checks what the server did.
  const deleted = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.status() === 200,
  );
  await page.getByRole("button", { name: "Delete note 1" }).click();
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await deleted;
  await page.reload();
  await expect(page.getByText("No notes yet.")).toBeVisible();
});

test("the Dashboard lists, searches, renames and deletes workspaces, keeping documents", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const { documentId } = await seedDocument(user.id, "A document to keep", "ready");
  await createWorkspace(page, "Tidal notes");
  await createWorkspace(page, "Heat notes");

  await page.goto("/dashboard?tab=research");
  const list = page.getByRole("list", { name: "Research workspaces" });
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await page.getByLabel("Search your workspaces").fill("Tidal");
  await expect(page).toHaveURL(/q=Tidal/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Search your workspaces").fill("no such thing");
  await expect(page.getByText("No workspaces match that search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await page.getByRole("button", { name: "Actions for Tidal notes" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Enter a name.")).toBeVisible();
  await dialog.getByLabel("Name").fill("Tidal barrier notes");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("link", { name: "Tidal barrier notes" })).toBeVisible();

  await page.getByRole("button", { name: "Actions for Heat notes" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText(/Your documents stay in your library/)).toBeVisible();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // The rail on the Overview tab shows real workspaces.
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(
    page.getByRole("list", { name: "Recent workspaces" }).getByRole("link", {
      name: "Tidal barrier notes",
    }),
  ).toBeVisible();

  await page.goto(`/read/${documentId}`);
  await expect(page.getByRole("heading", { name: "A document to keep" })).toBeVisible();
});

test("another user's workspace and a made-up one look the same", async ({
  browser,
  context,
  page,
}) => {
  // Four page loads, each compiled on first visit by a dev server.
  test.setTimeout(240_000);
  await signedInUser(context);
  await createWorkspace(page, "Mine alone");
  const address = page.url();

  const otherContext = await browser.newContext();
  const stranger = await createTestUser();
  created.push(stranger.id);
  await signInAs(otherContext, stranger);
  const otherPage = await otherContext.newPage();
  await otherPage.goto(address);
  await expect(
    otherPage.getByRole("heading", { name: "This workspace isn't available." }),
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(otherPage.getByText("Mine alone")).toHaveCount(0);
  await otherPage.goto(`/dashboard/research/${randomUUID()}`);
  await expect(
    otherPage.getByRole("heading", { name: "This workspace isn't available." }),
  ).toBeVisible();
  await otherPage.goto("/dashboard/research/not-a-real-id");
  await expect(
    otherPage.getByRole("heading", { name: "This workspace isn't available." }),
  ).toBeVisible();
  await otherContext.close();
});

test("the workspace layout fits a phone with no sideways scroll", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Runs at phone width.");
  const user = await signedInUser(context);
  await seedDocument(
    user.id,
    "A very long document title that has to wrap or truncate somewhere",
    "ready",
  );
  await createWorkspace(page, "Phone workspace");
  await page.getByRole("button", { name: "Add sources" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: /^Add A very long/ }).click();
  await expect(page.getByText("Source added.")).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("list", { name: "Workspace sources" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
