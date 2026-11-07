import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  currentVersionOf,
  deleteTestUsers,
  DRAFT_HASH,
  hasTestAuth,
  projectSnapshot,
  seedDocument,
  seedProject,
  seedProposals,
  signInAs,
  softDeleteDocument,
} from "./auth";
import { expectNoHorizontalOverflow, watchConsole } from "./helpers";

/*
 * My Projects and PDF Studio with seeded projects: no AI provider or worker is
 * needed, so these run everywhere. The real generation and export flow is in
 * studio.spec.ts.
 */

const created: string[] = [];
const S1 = "00000000-0000-4000-8000-0000000000f1";
const S2 = "00000000-0000-4000-8000-0000000000f2";
const S3 = "00000000-0000-4000-8000-0000000000f3";
const OUTLINE = [
  { id: S1, heading: "Why cities run hot", notes: "Causes." },
  { id: S2, heading: "What cools a street", notes: "Measures." },
  { id: S3, heading: "Where to start", notes: "Priorities." },
];

const section = (id: string, heading: string, text: string) => [
  {
    type: "heading",
    attrs: { level: 2, sectionId: id },
    content: [{ type: "text", text: heading }],
  },
  { type: "paragraph", content: [{ type: "text", text }] },
];
const DRAFT = {
  type: "doc",
  content: [
    ...section(S1, "Why cities run hot", "Dark roofs store heat."),
    ...section(S2, "What cools a street", "Trees shade the pavement."),
    ...section(S3, "Where to start", "Begin with schools."),
  ],
};

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

const studioUrl = (id: string) => `/dashboard/projects/${id}`;

/** The editor has loaded and says it's in step with the server. */
async function editorReady(page: Page) {
  await expect(page.getByLabel("Document text")).toBeVisible({ timeout: 45_000 });
}

test("a new account sees the empty state, and creating a general project opens the Studio", async ({
  context,
  page,
}) => {
  await signedInUser(context);
  const errors = watchConsole(page);
  await page.goto("/dashboard/projects");
  await expect(page.getByRole("heading", { name: "Your ideas, taking shape." })).toBeVisible();
  await expect(page.getByText("No projects yet.")).toBeVisible();

  await page.getByRole("button", { name: "Create a PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  // With no ready documents, general writing is what's left.
  await expect(dialog.getByRole("radio", { name: /General writing/ })).toBeChecked({
    timeout: 20_000,
  });
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByText("Enter a title.")).toBeVisible();
  await dialog.getByLabel("Title").fill("Why bridges sing");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Why bridges sing" })).toBeVisible();
  // Section 6: general writing says what it is, up front.
  await expect(page.getByText("AI generated, not grounded in your sources")).toBeVisible();
  await expect(page.getByText("Uses 1 of your 2 generated projects this month.")).toBeVisible();
  await expect(page.getByText("Your outline appears here")).toBeVisible();
  await editorReady(page);
  expect(errors).toEqual([]);
  await expectNoHorizontalOverflow(page);
});

test("research mode needs a source, and the picker offers only this user's ready documents", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  await seedDocument(user.id, "Ready harbor plan", "ready");
  await seedDocument(user.id, "Still processing", "queued");
  const other = await createTestUser();
  created.push(other.id);
  await seedDocument(other.id, "Someone else's plan", "ready");

  await page.goto("/dashboard/projects");
  await page.getByRole("button", { name: "Create a PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Harbor report");
  const list = dialog.getByRole("list", { name: "Ready documents" });
  await expect(list.getByRole("listitem")).toHaveCount(1, { timeout: 20_000 });
  await expect(dialog.getByText("Still processing")).toHaveCount(0);
  await expect(dialog.getByText("Someone else's plan")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByText("Select at least one source")).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Use Ready harbor plan" }).click();
  await dialog.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  const sources = page.getByRole("list", { name: "Connected sources" });
  await expect(sources.getByText("Ready harbor plan")).toBeVisible();
  await expect(page.getByText("AI generated, not grounded in your sources")).toHaveCount(0);
});

test("row actions rename, duplicate, archive and delete, and filters live in the URL", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  await seedProject(user.id, { title: "Alpha report", status: "complete" });
  await seedProject(user.id, { title: "Beta notes", status: "failed", template: "study-notes" });
  await seedProject(user.id, { title: "Gamma essay", mode: "general", status: "outline" });

  await page.goto("/dashboard/projects");
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(page.getByText("Showing 1–3")).toBeVisible();
  await expect(table.getByText("Study Notes · 0 sources")).toBeVisible();
  await expect(table.getByText("Academic Report · General writing")).toBeVisible();

  // Search and each filter narrow the list, and the URL holds them.
  await page.getByLabel("Search your projects").fill("gamma");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(page).toHaveURL(/q=gamma/);
  await page.reload();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(table.getByRole("row")).toHaveCount(4);

  await page.getByLabel("Status").click();
  await page.getByRole("option", { name: "Failed" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByText("Beta notes")).toBeVisible();
  await expect(page).toHaveURL(/status=failed/);
  await page.getByRole("button", { name: "Clear filters" }).first().click();

  await page.getByLabel("Mode").click();
  await page.getByRole("option", { name: "General writing" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear filters" }).first().click();

  await page.getByLabel("Template").click();
  await page.getByRole("option", { name: "Study Notes" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(table.getByRole("row")).toHaveCount(4);

  // Nothing matches: an honest empty state with a way back.
  await page.getByLabel("Search your projects").fill("zzzz");
  await expect(page.getByText("No projects match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(table.getByRole("row")).toHaveCount(4);

  const actions = (title: string) => page.getByRole("button", { name: `Actions for ${title}` });

  await actions("Alpha report").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog");
  await rename.getByLabel("Title").fill("Alpha renamed");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(table.getByText("Alpha renamed")).toBeVisible();

  await actions("Alpha renamed").click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(table.getByText("Alpha renamed (copy)")).toBeVisible();

  await actions("Alpha renamed (copy)").click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(table.getByText("Alpha renamed (copy)")).toHaveCount(0);
  await page.getByLabel("Archived").click();
  await page.getByRole("option", { name: "Archived" }).click();
  await expect(table.getByText("Alpha renamed (copy)")).toBeVisible();
  await actions("Alpha renamed (copy)").click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(page.getByText("No projects match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();

  await actions("Beta notes").click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("PDFs you've already downloaded stay yours")).toBeVisible();
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await expect(table.getByText("Beta notes")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("table").getByText("Beta notes")).toHaveCount(0);
});

test("Previous and Next walk the list with cursors", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  for (let index = 0; index < 23; index += 1) {
    await seedProject(user.id, { title: `Report ${String(index).padStart(2, "0")}` });
  }
  await page.goto("/dashboard/projects?sort=title");
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(21);
  await expect(page.getByText("Showing 1–20")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table.getByText("Report 22")).toBeVisible();
  await expect(page.getByText("Showing 21–23")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(table.getByText("Report 00")).toBeVisible();
  await expect(page.getByText("Showing 1–20")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
});

test("the Dashboard lists real recent projects", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  await seedProject(user.id, { title: "Dashboard report", status: "editing" });
  await page.goto("/dashboard");
  const recent = page.getByRole("region", { name: "Your recent projects" });
  await expect(recent.getByRole("link", { name: "Dashboard report" })).toBeVisible();
  await expect(recent.getByText("Editing")).toBeVisible();
  await page.getByRole("button", { name: "Create a PDF" }).first().click();
  await expect(page.getByRole("dialog").getByText("Starting point")).toBeVisible();
});

test("another user can't open a project or reach any of its routes", async ({
  context,
  page,
  browser,
}) => {
  const owner = await createTestUser();
  created.push(owner.id);
  const projectId = await seedProject(owner.id, {
    title: "Private report",
    status: "editing",
    outline: OUTLINE,
    content: DRAFT,
  });

  await signedInUser(context);
  const errors = watchConsole(page, { allowNotFound: true });
  await page.goto(studioUrl(projectId));
  await expect(page.getByRole("heading", { name: "This project isn't available." })).toBeVisible();
  await expect(page.getByText("Private report")).toHaveCount(0);
  expect(errors).toEqual([]);

  const asStranger = context.request;
  const json = { headers: { origin: "http://localhost:3000" } };
  expect((await asStranger.get(`/api/projects/${projectId}`)).status()).toBe(404);
  expect((await asStranger.get(`/api/projects/${projectId}/preview`)).status()).toBe(404);
  const generate = await asStranger.post(`/api/projects/${projectId}/generate`, {
    ...json,
    data: { kind: "outline" },
  });
  expect(generate.status()).toBe(404);
  const exported = await asStranger.post(`/api/projects/${projectId}/exports`, {
    ...json,
    data: { revisionId: randomUUID() },
  });
  expect(exported.status()).toBe(404);
  expect(
    (await asStranger.get(`/api/projects/${projectId}/exports/${randomUUID()}/download`)).status(),
  ).toBe(404);

  // Guests get 401, and a mutation from another origin gets 403.
  const guest = await browser.newContext({ baseURL: "http://localhost:3000" });
  expect((await guest.request.get(`/api/projects/${projectId}`)).status()).toBe(401);
  expect((await guest.request.get(`/api/projects/${projectId}/preview`)).status()).toBe(401);
  await guest.close();
  const crossOrigin = await asStranger.post(`/api/projects/${projectId}/generate`, {
    headers: { origin: "https://evil.test" },
    data: { kind: "outline" },
  });
  expect(crossOrigin.status()).toBe(403);
});

test("the editor autosaves, keeps a revision, and shows edited citations as unverified", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const { versionId } = await seedDocument(user.id, "Harbor plan", "ready").then(async (doc) => ({
    versionId: await currentVersionOf(doc.documentId),
  }));
  const content = {
    type: "doc",
    content: [
      ...section(S1, "Why cities run hot", "Dark roofs store heat.").slice(0, 1),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Dark roofs store heat" },
          {
            type: "citation",
            attrs: {
              label: "1",
              chunkId: null,
              versionId,
              pageStart: 3,
              pageEnd: 3,
              // The fingerprint of the sentence as drafted.
              draftHash: DRAFT_HASH,
            },
          },
          { type: "text", text: "." },
        ],
      },
    ],
  };
  const projectId = await seedProject(user.id, {
    title: "Heat report",
    status: "editing",
    outline: OUTLINE,
    content,
    prompt: "A report on urban heat for students.",
    versionIds: [versionId],
    firstDraft: true,
  });

  const errors = watchConsole(page);
  await page.goto(studioUrl(projectId));
  await editorReady(page);
  const editor = page.getByLabel("Document text");
  await expect(editor.getByText("Dark roofs store heat")).toBeVisible();
  await expect(editor.locator(".fm-cite")).toHaveText("[1]");
  const citations = page.getByRole("heading", { name: "Citations" }).locator("..");
  await expect(citations.getByRole("button", { name: /Harbor plan, p\. 3/ })).toBeVisible();
  await expect(citations.getByText("Edited since drafting")).toHaveCount(0);

  // Typing in that sentence: it autosaves, and the citation stays but isn't verified.
  await editor.getByText("Dark roofs store heat").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("Often, ");
  await expect(page.getByText("Not saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(editor.locator(".fm-cite")).toHaveText("[1]");
  await expect(citations.getByText("Edited since drafting")).toBeVisible();

  await page.reload();
  await editorReady(page);
  await expect(page.getByLabel("Document text").getByText("Often, Dark roofs")).toBeVisible();

  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("Saved as revision 1.")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("region", { name: "Revisions" }).getByText("Revision 1"),
  ).toBeVisible();

  // A second save with nothing new makes no new revision.
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("Nothing changed since revision 1.")).toBeVisible({
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});

test("a change from another tab becomes a choice, and neither version is lost", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const projectId = await seedProject(user.id, {
    title: "Two tabs",
    status: "editing",
    content: DRAFT,
    outline: OUTLINE,
    firstDraft: true,
  });

  await page.goto(studioUrl(projectId));
  await editorReady(page);
  const other = await context.newPage();
  await other.goto(studioUrl(projectId));
  await editorReady(other);

  await other.getByLabel("Document text").getByText("Begin with schools.").click();
  await other.keyboard.press("End");
  await other.keyboard.type(" Other tab.");
  await expect(other.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await other.waitForTimeout(500);

  await page.getByLabel("Document text").getByText("Trees shade the pavement.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" This tab.");
  const conflict = page.getByRole("alertdialog");
  await expect(conflict.getByText("This project changed in another tab.")).toBeVisible({
    timeout: 20_000,
  });

  await conflict.getByRole("button", { name: "Keep this tab's text" }).click();
  await expect(page.getByLabel("Document text").getByText("This tab.")).toBeVisible();
  await expect(page.getByText("The other version is saved as a revision.")).toBeVisible();

  const snapshot = await projectSnapshot(projectId);
  expect(JSON.stringify(snapshot.content)).toContain("This tab.");
  expect(JSON.stringify(snapshot.content)).not.toContain("Other tab.");
  expect(JSON.stringify(snapshot.revisions)).toContain("Other tab.");
  await other.close();
});

test("a proposal sits beside the text and changes nothing until it's chosen", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const proposal = (text: string) => ({
    sectionId: S2,
    jobId: randomUUID(),
    nodes: section(S2, "What cools a street", text),
    createdAt: new Date().toISOString(),
  });
  const projectId = await seedProject(user.id, {
    title: "Proposal report",
    status: "editing",
    content: DRAFT,
    outline: OUTLINE,
    firstDraft: true,
    proposals: [proposal("The model's rewrite.")],
  });

  await page.goto(studioUrl(projectId));
  await editorReady(page);
  const panel = page.getByRole("region", { name: /New version of/ });
  await expect(panel.getByText("Your text")).toBeVisible();
  await expect(panel.getByText("Trees shade the pavement.")).toBeVisible();
  await expect(panel.getByText("The model's rewrite.")).toBeVisible();
  // The editor still has the owner's text.
  const editor = page.getByLabel("Document text");
  await expect(editor.getByText("Trees shade the pavement.")).toBeVisible();
  await expect(editor.getByText("The model's rewrite.")).toHaveCount(0);

  // Decline: the text stays, and the proposal goes.
  await panel.getByRole("button", { name: "Keep my text" }).click();
  await expect(panel).toHaveCount(0);
  await expect(editor.getByText("Trees shade the pavement.")).toBeVisible();
  let snapshot = await projectSnapshot(projectId);
  expect(JSON.stringify(snapshot.content)).toContain("Trees shade the pavement.");
  expect(snapshot.proposals).toEqual([]);

  // Choosing one replaces only that section, and keeps the earlier text as a revision.
  await seedProposals(projectId, [proposal("A second rewrite.")]);
  await page.reload();
  await editorReady(page);
  await page
    .getByRole("region", { name: /New version of/ })
    .getByRole("button", { name: "Use this version" })
    .click();
  await expect(page.getByText("New version in place.")).toBeVisible({ timeout: 20_000 });
  const after = page.getByLabel("Document text");
  await expect(after.getByText("A second rewrite.")).toBeVisible();
  await expect(after.getByText("Dark roofs store heat.")).toBeVisible();
  await expect(after.getByText("Trees shade the pavement.")).toHaveCount(0);
  snapshot = await projectSnapshot(projectId);
  expect(JSON.stringify(snapshot.revisions)).toContain("Trees shade the pavement.");
});

test("outlines are edited within the limits, and saved without being drafted", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const projectId = await seedProject(user.id, {
    title: "Outline report",
    status: "outline",
    outline: OUTLINE,
    prompt: "A report on urban heat for students.",
    mode: "general",
  });

  await page.goto(studioUrl(projectId));
  const outline = page.getByRole("list", { name: "Outline sections" });
  await expect(outline.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Approve & create draft" })).toBeVisible();

  // At three sections none can be removed; the first can't move up.
  await expect(page.getByRole("button", { name: "Remove section 1" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move section 1 up" })).toBeDisabled();

  await page.getByRole("button", { name: "Add a section" }).click();
  await expect(outline.getByRole("listitem")).toHaveCount(4);
  await page.getByLabel("Section 4 heading").fill("Costs and funding");
  await page.getByRole("button", { name: "Move section 4 up" }).click();
  await expect(page.getByLabel("Section 3 heading")).toHaveValue("Costs and funding");
  await page.getByRole("button", { name: "Remove section 1" }).click();
  await expect(outline.getByRole("listitem")).toHaveCount(3);

  // An empty heading is refused and said plainly.
  await page.getByLabel("Section 1 heading").fill("");
  await expect(page.getByText("Give this section a heading.")).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Section 1 heading").fill("What cools a street");

  await expect
    .poll(async () => (await projectSnapshot(projectId)).outline.map((item) => item.heading), {
      timeout: 15_000,
    })
    .toEqual(["What cools a street", "Costs and funding", "Where to start"]);
  await page.reload();
  await expect(page.getByLabel("Section 2 heading")).toHaveValue("Costs and funding");
  // Editing the outline wrote no document text.
  expect(JSON.stringify((await projectSnapshot(projectId)).content)).not.toContain("paragraph");
});

test("a source that became unavailable blocks generating, with a clear way out", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const document = await seedDocument(user.id, "Deleted later", "ready");
  const projectId = await seedProject(user.id, {
    title: "Blocked report",
    prompt: "A report on urban heat for students.",
    versionIds: [await currentVersionOf(document.documentId)],
  });
  await softDeleteDocument(document.documentId);

  await page.goto(studioUrl(projectId));
  await expect(page.getByText("A source isn't available anymore.")).toBeVisible();
  await expect(page.getByText("Deleted later")).toBeVisible();
  await expect(page.getByText("No longer available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate outline" })).toBeDisabled();

  const refused = await context.request.post(`/api/projects/${projectId}/generate`, {
    headers: { origin: "http://localhost:3000" },
    data: { kind: "outline" },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("source_unavailable");

  await page.getByRole("button", { name: "Remove Deleted later" }).click();
  await expect(page.getByText("A source isn't available anymore.")).toHaveCount(0);
  await expect(page.getByText("No sources connected.")).toBeVisible();
});

test("Preview is the export's HTML with scripts and loading shut off", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  const user = await signedInUser(context);
  const projectId = await seedProject(user.id, {
    title: "<script>alert(1)</script> Report",
    status: "editing",
    content: {
      type: "doc",
      content: [...section(S1, "Why cities run hot", '<img src="http://evil.test/x"> stays text.')],
    },
    outline: OUTLINE,
    firstDraft: true,
  });

  const response = await context.request.get(`/api/projects/${projectId}/preview`);
  expect(response.status()).toBe(200);
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("sandbox");
  expect(csp).toContain("default-src 'none'");
  const html = await response.text();
  expect(html).not.toContain("<script>alert");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain("<h2>Why cities run hot</h2>");

  await page.goto(studioUrl(projectId));
  await editorReady(page);
  await page.getByRole("button", { name: "Preview" }).click();
  const frame = page.getByRole("dialog").locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Why cities run hot" }),
  ).toBeVisible({ timeout: 20_000 });
});

test("the Studio has no sideways scroll at phone width", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Runs at phone width.");
  const user = await signedInUser(context);
  const projectId = await seedProject(user.id, {
    title: "A very long project title that has to wrap on a small phone screen somehow",
    status: "editing",
    content: DRAFT,
    outline: OUTLINE,
    firstDraft: true,
    proposals: [
      {
        sectionId: S2,
        jobId: randomUUID(),
        nodes: section(S2, "What cools a street", "The model's rewrite."),
        createdAt: new Date().toISOString(),
      },
    ],
  });
  await page.goto(studioUrl(projectId));
  await editorReady(page);
  await expect(page.getByRole("region", { name: /New version of/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // The rail sits above the editor.
  const rail = await page.getByRole("heading", { name: "Shape your document" }).boundingBox();
  const editor = await page.getByLabel("Document text").boundingBox();
  expect(rail!.y).toBeLessThan(editor!.y);
  await page.goto("/dashboard/projects");
  await expect(page.getByRole("table")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
