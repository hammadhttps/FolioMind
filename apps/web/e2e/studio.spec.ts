import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  generationSummary,
  hasAiKeys,
  hasConnectedWorker,
  hasGenerationWorker,
  hasTestAuth,
  signInAs,
  uploadThingToken,
} from "./auth";

/*
 * Phase 8 end to end, with nothing faked: a real PDF through UploadThing and
 * Worker A, then real Jina, real Gemini and real Chromium through Worker B, and
 * a real file back from UploadThing. Needs the local stack, the API keys and both
 * workers connected to the Inngest Dev Server. Text is checked for what the
 * document says, never for exact wording.
 *
 * Each draft makes one Gemini request per section. Run Worker B with
 * GEMINI_GENERATION_MODEL=gemini-3.5-flash-lite so a run doesn't spend the 20
 * requests a day the deployed site shares.
 */

const HARBOR = path.resolve(__dirname, "fixtures/harbor-plan.pdf");
const created: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, at desktop width.");
  test.skip(!uploadThingToken(), "Set UPLOADTHING_TOKEN in apps/web/.env.local.");
  test.skip(!hasAiKeys(), "Set GEMINI_API_KEY and JINA_API_KEY in apps/web/.env.local.");
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
  test.skip(!(await hasConnectedWorker()), "Start Worker A against the Inngest Dev Server.");
  test.skip(!(await hasGenerationWorker()), "Start Worker B against the Inngest Dev Server.");
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
}

const editor = (page: Page) => page.getByLabel("Document text");

/** Downloads through the page's own link and returns the bytes. */
async function download(page: Page, link: ReturnType<Page["getByRole"]>): Promise<Buffer> {
  const [file] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

let studioUrl = "";
let exportUrl = "";

test("workspace → outline → edit → approve → draft → revision → decline → export → download", async ({
  context,
  page,
}) => {
  test.setTimeout(600_000);
  const user = await signedIn(context);
  await uploadAndWaitReady(page, HARBOR, "Harbor plan e2e");

  // From a workspace, carrying the source.
  await page.goto("/dashboard?tab=research");
  await page.getByRole("button", { name: "New workspace" }).first().click();
  await page.getByRole("dialog").getByLabel("Name").fill("Tidal barrier research");
  await page.getByRole("dialog").getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/dashboard\/research\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await page.getByRole("button", { name: "Add sources" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Add Harbor plan e2e" }).click();
  await expect(page.getByText("Source added.")).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Turn into a PDF" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  studioUrl = new URL(page.url()).pathname;

  await expect(page.getByRole("list", { name: "Connected sources" })).toContainText(
    "Harbor plan e2e",
  );
  // Asking for an outline needs a real brief.
  await page.getByRole("button", { name: "Generate outline" }).click();
  await expect(page.getByText("Describe the document in at least 10 characters.")).toBeVisible();

  await page
    .getByLabel("What should this document cover?")
    .fill("A short briefing on the Tamsin Tidal Barrier: its cost, schedule and purpose.");
  await page.getByLabel("Target audience").fill("City council members");
  await page.getByLabel("Approximate length").click();
  await page.getByRole("option", { name: /^Short/ }).click();
  await expect(page.getByText("Uses 1 of your 2 generated projects this month.")).toBeVisible();
  await page.getByRole("button", { name: "Generate outline" }).click();

  // The outline is generated, and nothing is drafted until it's approved.
  const outline = page.getByRole("list", { name: "Outline sections" });
  await expect(outline.getByRole("listitem").first()).toBeVisible({ timeout: 180_000 });
  const sections = await outline.getByRole("listitem").count();
  expect(sections).toBeGreaterThanOrEqual(3);
  expect(sections).toBeLessThanOrEqual(5);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator(".fm-cite")).toHaveCount(0);
  await expect(page.getByText("Included with this project.")).toBeVisible();

  // Editing the outline counts: the renamed heading is what gets drafted.
  await page.getByLabel("Section 1 heading").fill("The barrier at a glance");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Approve & create draft" }).click();

  // The draft fills section by section, read-only until it's done.
  await expect(page.getByText("Drafting your document", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(editor(page).getByRole("heading", { name: "The barrier at a glance" })).toBeVisible({
    timeout: 240_000,
  });
  await expect(page.getByText("Your draft is ready to edit.").first()).toBeVisible({
    timeout: 300_000,
  });

  // It cites real pages of the source, which open in the Reader.
  const chips = editor(page).locator(".fm-cite");
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeGreaterThan(0);
  const references = page.getByRole("heading", { name: "Citations" }).locator("..");
  await expect(
    references.getByRole("button", { name: /Harbor plan e2e, pp?\. \d+/ }).first(),
  ).toBeVisible();
  await expect(references.getByText("Edited since drafting")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Revisions" }).getByText("Revision 1"),
  ).toBeVisible();

  // Edit the text: autosave, then a revision.
  await editor(page).getByRole("heading", { name: "The barrier at a glance" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A note the author wrote by hand.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByText("Saved as revision 2.")).toBeVisible({ timeout: 20_000 });

  // Regenerate one section, then decline: the owner's text stays.
  await page.getByRole("button", { name: "Regenerate section" }).nth(1).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("Nothing changes unless you choose it.")).toBeVisible();
  await expect(confirm.getByText("Uses 1 of your 10 regenerations this month.")).toBeVisible();
  await confirm.getByRole("button", { name: "Regenerate" }).click();
  const proposal = page.getByRole("region", { name: /New version of/ });
  await expect(proposal.getByText("New version", { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  await expect(editor(page).getByText("A note the author wrote by hand.")).toBeVisible();
  await proposal.getByRole("button", { name: "Keep my text" }).click();
  await expect(proposal).toHaveCount(0);
  await expect(editor(page).getByText("A note the author wrote by hand.")).toBeVisible();

  // Preview, then export the exact revision. The first export comes with the project.
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "The barrier at a glance" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Export PDF" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Revision 2 as Academic Report, A4.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByText("Included with this project.")).toBeVisible();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();

  const exports = page.getByRole("region", { name: "Exports" });
  const downloadLink = exports.getByRole("link", { name: "Download" });
  await expect(downloadLink).toBeVisible({ timeout: 180_000 });
  await expect(exports).toContainText("Revision 2");
  await expect(exports).toContainText("Academic Report");
  await expect(exports).toContainText(/\d+ pages?/);

  const pdf = await download(page, downloadLink);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(5000);
  exportUrl = (await downloadLink.getAttribute("href")) ?? "";

  // Editing and exporting again spends a re-export, and says so first.
  await editor(page).getByText("A note the author wrote by hand.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" And one more line.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(
    page.getByRole("dialog").getByText("Revision 3 as Academic Report, A4."),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("dialog").getByText("Uses 1 of your 10 re-exports this month."),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // My Projects shows it, with the download on the row.
  await page.goto("/dashboard/projects");
  const row = page.getByRole("row").filter({ hasText: "Tidal barrier research" });
  await expect(row.getByText("Editing")).toBeVisible();
  await row.getByRole("button", { name: /Actions for/ }).click();
  const rowPdf = await download(page, page.getByRole("menuitem", { name: "Download latest PDF" }));
  expect(rowPdf.subarray(0, 5).toString()).toBe("%PDF-");

  // The notice arrived.
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByText("Your PDF is ready.").first()).toBeVisible({ timeout: 30_000 });

  // What it cost and how long it took, for the record in PROGRESS.md.
  console.info("research project", JSON.stringify(await generationSummary(user.id)));
});

test("another user can't open the project or download its export", async ({ browser }) => {
  test.skip(!studioUrl || !exportUrl, "Needs the export from the previous test.");
  const context = await browser.newContext({ baseURL: "http://localhost:3000" });
  await signedIn(context);
  const page = await context.newPage();
  await page.goto(studioUrl);
  await expect(page.getByRole("heading", { name: "This project isn't available." })).toBeVisible();
  expect((await context.request.get(exportUrl)).status()).toBe(404);
  await context.close();

  const guest = await browser.newContext({ baseURL: "http://localhost:3000" });
  expect((await guest.request.get(exportUrl)).status()).toBe(401);
  await guest.close();
});

test("general writing exports with the AI label and no citations", async ({ context, page }) => {
  test.setTimeout(420_000);
  const user = await signedIn(context);
  await page.goto("/dashboard/projects");
  await page.getByRole("button", { name: "Create a PDF" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /General writing/ }).click();
  await dialog.getByLabel("Title").fill("Why bridges sing");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  const projectUrl = new URL(page.url()).pathname;

  await page.getByText("AI generated, not grounded in your sources").first().waitFor();
  await page
    .getByLabel("What should this document cover?")
    .fill("A short explanation of why suspension bridges hum in strong wind.");
  await page.getByLabel("Approximate length").click();
  await page.getByRole("option", { name: /^Short/ }).click();
  await page.getByRole("radio", { name: "Study Notes" }).click();
  await page.getByRole("button", { name: "Generate outline" }).click();

  const outline = page.getByRole("list", { name: "Outline sections" });
  await expect(outline.getByRole("listitem").first()).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Approve & create draft" }).click();
  await expect(page.getByText("Your draft is ready to edit.").first()).toBeVisible({
    timeout: 300_000,
  });
  await expect(editor(page).locator(".fm-cite")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Citations" })).toHaveCount(0);

  // The exported HTML carries the label on the page, and no citation or reference list.
  const preview = await context.request.get(
    `/api/projects${projectUrl.slice("/dashboard/projects".length)}/preview`,
  );
  const html = await preview.text();
  expect(html).toContain("AI generated, not grounded in your sources");
  expect(html).not.toContain('class="fm-cite"');
  expect(html).not.toContain("References");

  await page.getByRole("button", { name: "Export PDF" }).click();
  const exportDialog = page.getByRole("dialog");
  await expect(exportDialog.getByText("Revision 1 as Study Notes, A4.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(exportDialog.getByText("has no citations", { exact: false })).toBeVisible();
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  const link = page
    .getByRole("region", { name: "Exports" })
    .getByRole("link", { name: "Download" });
  await expect(link).toBeVisible({ timeout: 180_000 });
  const pdf = await download(page, link);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  console.info("general project", JSON.stringify(await generationSummary(user.id)));
});
