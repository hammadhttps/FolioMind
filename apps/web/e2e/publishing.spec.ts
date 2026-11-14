import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  auditActionsFor,
  bookStatus,
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasConnectedWorker,
  hasTestAuth,
  publisherProfileId,
  searchMarker,
  seedBookDraft,
  seedPublishedBook,
  seedPublisher,
  setRole,
  signInAs,
  type TestUser,
} from "./auth";
import { expectNoHorizontalOverflow, watchConsole } from "./helpers";

/*
 * Section 6 "Publishing" end to end: apply, approve, submit, reject with a
 * reason, revise, approve, then the guest's and reader's view of the catalog,
 * follows, saves and reports. Book PDFs are seeded as processed sources (the
 * real UploadThing and ingestion path is covered in publishing-upload.spec.ts),
 * so this runs without providers or workers.
 */

const created: string[] = [];

test.beforeEach(async ({ request }) => {
  test.skip(!(await hasTestAuth(request)), "The server has no test Auth0 settings.");
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

async function newUser(role?: "admin"): Promise<TestUser> {
  const user = await createTestUser();
  created.push(user.id);
  if (role) await setRole(user.id, role);
  return user;
}

async function pageAs(browser: Browser, user: TestUser | null): Promise<Page> {
  const context = await browser.newContext();
  if (user) await signInAs(context, user);
  return context.newPage();
}

test("apply, approve, submit, reject with a reason, revise, approve, then read it", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The journey runs once; layouts are checked separately.",
  );
  test.setTimeout(300_000);
  const tag = randomUUID().slice(0, 8);
  const publisherName = `Fieldnotes ${tag}`;
  const slug = `fieldnotes-${tag}`;
  const bookTitle = `Rivers ${tag} restored`;
  const reader = await newUser();
  const admin = await newUser("admin");

  // A reader applies to publish.
  const publisher = await pageAs(browser, reader);
  const errors = watchConsole(publisher);
  await publisher.goto("/dashboard/publishing");
  await expect(
    publisher.getByRole("heading", { name: "Good ideas deserve good company." }),
  ).toBeVisible();
  await publisher.getByLabel("Publisher name").fill(publisherName);
  await publisher.getByLabel("Page address").fill(slug);
  await publisher
    .getByLabel("Biography")
    .fill(
      "An independent press for field guides about rivers, wetlands and the people who restore them.",
    );
  await publisher.getByLabel(/only publish books I hold the rights/).check();
  await publisher.getByRole("button", { name: "Send application" }).click();
  await expect(publisher.getByText("Your application is waiting for review")).toBeVisible();

  // The admin approves it, which grants the role.
  const moderator = await pageAs(browser, admin);
  await moderator.goto("/admin?tab=applications");
  const application = moderator.getByRole("listitem").filter({ hasText: publisherName });
  await expect(application).toBeVisible();
  await application.getByRole("button", { name: "Approve" }).click();
  await moderator.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(moderator.getByText("Approved. They're now a publisher.")).toBeVisible();

  await publisher.reload();
  await expect(publisher.getByRole("button", { name: "Submit a publication" })).toBeVisible();

  // A draft whose PDF has been processed (uploading is covered elsewhere).
  const publisherProfile = await publisherProfileId(slug);
  const draft = await seedBookDraft(reader.id, publisherProfile, bookTitle);
  await publisher.goto(`/dashboard/publishing?book=${draft.bookId}`);
  await expect(publisher.getByRole("heading", { name: bookTitle })).toBeVisible();
  await expect(publisher.getByText("Ready · 12 pages")).toBeVisible();

  // Submitting checks Section 28: a short description is refused with a field error.
  await publisher.getByLabel("Author", { exact: true }).fill("Ada Rivers");
  await publisher.getByLabel("Description", { exact: true }).fill("Too short.");
  await publisher.getByLabel(/I hold the rights to share this book/).check();
  await publisher.getByRole("button", { name: "Submit for review" }).click();
  await expect(publisher.getByText("Write at least 50 characters.")).toBeVisible();
  await publisher
    .getByLabel("Description", { exact: true })
    .fill(
      "A practical guide to restoring urban rivers, with case studies from three cities and planting notes.",
    );
  await publisher.getByLabel("Environment", { exact: true }).check();
  await publisher
    .getByLabel("License statement")
    .fill("Published under CC BY 4.0 by the author, who holds all rights.");
  await publisher.getByRole("button", { name: "Submit for review" }).click();
  await expect(publisher.getByText("Waiting for review", { exact: true })).toBeVisible();

  // Pending revisions are invisible to everyone else.
  const guest = await pageAs(browser, null);
  await guest.goto(`/books/${draft.bookId}`);
  await expect(guest.getByText("This book isn't available.")).toBeVisible();

  // The moderator rejects with a reason.
  await moderator.goto("/admin/moderation");
  const row = moderator.getByRole("row").filter({ hasText: bookTitle });
  await row.getByRole("button", { name: "Review" }).click();
  const sheet = moderator.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: bookTitle })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Open the PDF" })).toHaveAttribute(
    "href",
    `/api/admin/submissions/${draft.revisionId}/source`,
  );
  const reason = "Please name the rights holder in the license statement.";
  await sheet.getByRole("button", { name: "Reject" }).click();
  const rejectDialog = moderator.getByRole("dialog").filter({ hasText: "Reject this submission?" });
  await rejectDialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(rejectDialog.getByText("Give a reason.")).toBeVisible();
  await rejectDialog.getByLabel("Reason", { exact: true }).fill(reason);
  await rejectDialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(moderator.getByText("Rejected. The publisher has been told why.")).toBeVisible();
  expect(await auditActionsFor(draft.revisionId)).toEqual(["book.submitted", "book.rejected"]);

  // The publisher reads the reason, revises and resubmits as revision 2.
  await publisher.reload();
  await expect(publisher.getByText("Revision 1 wasn't approved")).toBeVisible();
  await expect(publisher.getByText(reason).first()).toBeVisible();
  await publisher.getByRole("button", { name: "Revise" }).click();
  await expect(publisher.getByText("A new draft is ready to edit.")).toBeVisible();
  await publisher
    .getByLabel("License statement")
    .fill("Published under CC BY 4.0 by Ada Rivers, who holds all rights to this edition.");
  await publisher.getByLabel(/I hold the rights to share this book/).check();
  await publisher.getByRole("button", { name: "Submit for review" }).click();
  await expect(publisher.getByText("Waiting for review", { exact: true })).toBeVisible();

  // Approval publishes it.
  await moderator.goto("/admin/moderation");
  await moderator
    .getByRole("row")
    .filter({ hasText: bookTitle })
    .getByRole("button", { name: "Review" })
    .click();
  await moderator.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await moderator
    .getByRole("dialog")
    .filter({ hasText: "Approve this submission?" })
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(moderator.getByText("Approved. It's live in the library.")).toBeVisible();
  expect(await bookStatus(draft.bookId)).toBe("published");

  // A guest finds it in Explore and opens the details.
  await guest.goto(`/library?q=${encodeURIComponent(`rivers ${tag}`)}`);
  await guest.getByRole("link", { name: bookTitle }).click();
  await expect(guest.getByRole("heading", { level: 1, name: bookTitle })).toBeVisible();
  await expect(guest.getByText(/^by Ada Rivers/)).toBeVisible();
  await expect(guest.getByText("Published under CC BY 4.0 by Ada Rivers")).toBeVisible();
  await guest.getByRole("button", { name: "Start reading" }).click();
  await expect(guest.getByRole("dialog").getByText("Continue with Google")).toBeVisible();

  // A reader saves it, opens it in the Reader, follows the publisher and reports it.
  const fan = await newUser();
  const fanPage = await pageAs(browser, fan);
  await fanPage.goto(`/books/${draft.bookId}`);
  await fanPage.getByRole("button", { name: "Save to library" }).click();
  await expect(fanPage.getByRole("button", { name: "Saved to library" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await fanPage.goto("/dashboard/library?type=saved");
  await expect(fanPage.getByRole("link", { name: bookTitle })).toBeVisible();
  await fanPage.goto(`/books/${draft.bookId}`);
  await fanPage.getByRole("link", { name: "Start reading" }).click();
  await expect(fanPage).toHaveURL(/\/read\//);
  await expect(fanPage.getByRole("heading", { name: bookTitle })).toBeVisible();

  await fanPage.goto(`/publishers/${slug}`);
  await expect(fanPage.getByRole("heading", { name: publisherName })).toBeVisible();
  await fanPage.getByRole("button", { name: "Follow publisher" }).click();
  await expect(fanPage.getByRole("button", { name: /Following/ })).toBeVisible();

  await fanPage.goto(`/books/${draft.bookId}`);
  await fanPage.getByRole("button", { name: "Report a concern" }).click();
  const report = fanPage.getByRole("dialog");
  await report.getByLabel("Something else").check();
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(report.getByText("Tell us what's wrong, in at least 10 characters.")).toBeVisible();
  await report
    .getByLabel("Details", { exact: true })
    .fill("The author's name is spelled wrong on the cover.");
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(fanPage.getByText("You reported a concern about this book.")).toBeVisible();

  // The publisher updates the listing; approval notifies the follower when Worker A runs.
  await publisher.goto(`/dashboard/publishing?book=${draft.bookId}`);
  await publisher.getByRole("button", { name: "Edit listing" }).click();
  await expect(publisher.getByText("A new draft is ready to edit.")).toBeVisible();
  await publisher.getByLabel("Title", { exact: true }).fill(`${bookTitle}, second edition`);
  await publisher.getByLabel(/I hold the rights to share this book/).check();
  await publisher.getByRole("button", { name: "Submit for review" }).click();
  await expect(publisher.getByText("Waiting for review", { exact: true })).toBeVisible();
  // The live listing keeps the approved title while the update waits.
  await guest.goto(`/books/${draft.bookId}`);
  await expect(guest.getByRole("heading", { level: 1, name: bookTitle })).toBeVisible();

  await moderator.goto("/admin/moderation");
  await moderator
    .getByRole("row")
    .filter({ hasText: `${bookTitle}, second edition` })
    .getByRole("button", { name: "Review" })
    .click();
  await moderator.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await moderator
    .getByRole("dialog")
    .filter({ hasText: "Approve this submission?" })
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(moderator.getByText("Approved. It's live in the library.")).toBeVisible();
  await guest.goto(`/books/${draft.bookId}`);
  await expect(
    guest.getByRole("heading", { level: 1, name: `${bookTitle}, second edition` }),
  ).toBeVisible();

  if (await hasConnectedWorker()) {
    // The fan has no other notices, so an unread badge means this one arrived.
    const unread = fanPage.getByRole("button", { name: /Notifications, \d+ unread/ });
    await expect(async () => {
      await fanPage.goto("/dashboard");
      await expect(unread).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    await unread.click();
    await expect(
      fanPage.getByText(`${publisherName} published “${bookTitle}, second edition”.`),
    ).toBeVisible();
  } else {
    testInfo.annotations.push({
      type: "skipped-step",
      description: "Worker A isn't connected, so the follower notice wasn't checked.",
    });
  }

  // The report reaches moderation; a takedown removes the book at once.
  await moderator.goto("/admin/moderation?type=report");
  const reported = moderator.getByRole("listitem").filter({ hasText: "spelled wrong" });
  await expect(reported).toBeVisible();
  await reported.getByRole("button", { name: "Take down" }).click();
  const takedown = moderator.getByRole("dialog").filter({ hasText: "Take this book down?" });
  await takedown
    .getByLabel("Reason", { exact: true })
    .fill("Takedown requested by the rights holder for this test.");
  await takedown.getByRole("button", { name: "Take down", exact: true }).click();
  await expect(moderator.getByText("Taken down.")).toBeVisible();
  await guest.goto(`/books/${draft.bookId}`);
  await expect(guest.getByText("This book isn't available.")).toBeVisible();
  await fanPage.goto(`/library?q=${encodeURIComponent(`rivers ${tag}`)}`);
  // Gone from search (a near match from other data may still appear through the typo fallback).
  await expect(fanPage.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(fanPage.getByRole("link", { name: new RegExp(tag) })).toHaveCount(0);
  await publisher.goto(`/dashboard/publishing?book=${draft.bookId}`);
  await expect(
    publisher.getByText("This book was removed from the library by moderation"),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test.describe("catalog", () => {
  let marker: string;
  let publisherSlug: string;
  let firstBook: string;

  test.beforeAll(async () => {
    marker = searchMarker();
    publisherSlug = `press-${marker}`;
    const owner = await createTestUser();
    created.push(owner.id);
    const publisherId = await seedPublisher(owner.id, {
      slug: publisherSlug,
      name: `Press ${marker}`,
    });
    // 26 books: more than one page of 24.
    for (let index = 0; index < 26; index += 1) {
      const book = await seedPublishedBook(owner.id, publisherId, {
        title: `Atlas ${marker} ${String(index).padStart(2, "0")}`,
        category: index % 2 === 0 ? "environment" : "design",
        publishedAt: new Date(Date.UTC(2026, 0, 1 + index)),
      });
      if (index === 25) firstBook = book.bookId;
    }
  });

  test("Explore searches, filters and pages through approved books in the URL", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto(`/library?q=${marker}`);
    await expect(page.getByText(`24 of 26 books`)).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: `Atlas ${marker} 25` }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Page 2" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(`2 of 26 books`)).toBeVisible();

    await page.goto(`/library?q=${marker}&category=design&sort=title`);
    await expect(page.getByText(`13 of 13 books`)).toBeVisible();
    const titles = await page.getByRole("heading", { level: 3 }).allTextContents();
    expect(titles).toEqual([...titles].sort());
    expect(titles.every((title) => Number(title.slice(-2)) % 2 === 1)).toBe(true);

    // A typo still finds the books through trigram similarity.
    await page.goto(`/library?q=${encodeURIComponent(`Atlss ${marker}`)}`);
    await expect(page.getByText(/of 26 books/)).toBeVisible();

    // A malformed URL falls back to defaults instead of failing.
    await page.goto(`/library?page=abc&sort=nonsense&q=${marker}`);
    await expect(page.getByText(`24 of 26 books`)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("filters collapse into a sheet with Apply on phones", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Phones only.");
    await page.goto(`/library?q=${marker}`);
    await page.getByRole("button", { name: /^Filters/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filter books" });
    await sheet.getByRole("button", { name: "Design" }).click();
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/category=design/);
    await expect(page.getByText(`13 of 13 books`)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("Book Details and Publisher Profile render published data and 404 otherwise", async ({
    page,
  }) => {
    const errors = watchConsole(page, { allowNotFound: true });
    await page.goto(`/books/${firstBook}`);
    await expect(page.getByRole("heading", { level: 1, name: `Atlas ${marker} 25` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Press ${marker}` })).toBeVisible();
    await expect(page.getByText("Seeded for tests; no rights are granted.")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: `Press ${marker}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Press ${marker}` })).toBeVisible();
    await expect(page.getByText("26 publications")).toBeVisible();
    await page.getByLabel(`Search Press ${marker}'s books`).fill(`${marker} 03`);
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);

    await page.goto(`/books/${randomUUID()}`);
    await expect(page.getByText("This book isn't available.")).toBeVisible();
    await page.goto(`/publishers/no-such-${marker}`);
    await expect(page.getByText(/publisher/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("global search returns the catalog and only the user's own content", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Keyboard shortcut on desktop.");
    const user = await newUser();
    const page = await pageAs(browser, user);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Search FolioMind" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByPlaceholder("Search books, your library or projects…")
      .fill(`Atlas ${marker} 2`);
    await expect(dialog.getByText("Books and authors")).toBeVisible();
    await expect(
      dialog.getByRole("option", { name: new RegExp(`Atlas ${marker} 2`) }).first(),
    ).toBeVisible();
    await expect(dialog.getByText("My Library")).toHaveCount(0);
    await dialog.getByRole("option", { name: new RegExp(`Atlas ${marker} 25`) }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${firstBook}`));
  });
});

test("admin suspension takes effect at once and is audited", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Admin tables are covered once here.");
  const admin = await newUser("admin");
  const target = await newUser();
  const targetPage = await pageAs(browser, target);
  await targetPage.goto("/dashboard");
  await expect(targetPage.getByRole("heading", { level: 1 })).toBeVisible();

  const page = await pageAs(browser, admin);
  await page.goto(`/admin?tab=users&q=${encodeURIComponent(target.email)}`);
  const row = page.getByRole("row").filter({ hasText: target.email });
  await row.getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Suspend" });
  await dialog.getByLabel("Reason", { exact: true }).fill("Repeated spam reports in this test.");
  await dialog.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByText("Account suspended.")).toBeVisible();
  await expect(row.getByText("Suspended")).toBeVisible();

  await targetPage.goto("/dashboard/library");
  await expect(targetPage).toHaveURL(/auth_error=suspended/);

  await page.goto("/admin?tab=audit&action=user.suspended");
  await expect(page.getByRole("row").filter({ hasText: target.id })).toBeVisible();
  expect(await auditActionsFor(target.id)).toContain("user.suspended");
  await page.goto("/admin?tab=health");
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
  await page.goto("/admin?tab=usage");
  await expect(page.getByText("By day and purpose")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("admin tables stay usable on phones", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phones only.");
  const admin = await newUser("admin");
  const page = await pageAs(browser, admin);
  for (const path of ["/admin", "/admin?tab=users", "/admin?tab=audit", "/admin/moderation"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
