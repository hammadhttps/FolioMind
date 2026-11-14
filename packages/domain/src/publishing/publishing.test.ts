import { randomUUID } from "node:crypto";
import { EVENT_NAMES, type BookSubmissionInput } from "@foliomind/contracts";
import {
  analyticsDaily,
  books,
  categories,
  contentReports,
  documents,
  documentVersions,
  libraryItems,
  outboxEvents,
  publisherProfiles,
  uploadIntents,
  users,
  type Database,
} from "@foliomind/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { canReadDocumentVersion } from "../access";
import { cacheKeys, createRedis } from "../cache";
import { createNotification } from "../notifications";
import { createUser, describeWithDatabase, testDb } from "../test/db";
import { TEST_REDIS } from "../test/env";
import { ownedSourceCount, storageBytesUsed } from "../usage";
import {
  applyToPublish,
  bookViewerState,
  catalogCards,
  completeBookSourceUpload,
  completeCoverUpload,
  createBook,
  decideSubmission,
  deleteBookDraft,
  followersToNotify,
  getPublicBook,
  getPublisherBook,
  listPublisherBooks,
  listReports,
  listSubmissions,
  loadFacets,
  prepareBookUpload,
  publisherStats,
  recordBookRead,
  reportBook,
  resolveReport,
  reviewPublisherApplication,
  reviseBook,
  saveBookDraft,
  searchCatalogIds,
  setBookSaved,
  setFollow,
  submitBook,
  submissionSourceFile,
  takedownBook,
  unpublishBook,
  updatePublisherProfile,
  withdrawSubmission,
} from "./index";

const EMBEDDING = { model: "test-model", dimension: 1024 };

type Db = Database;

async function approvedPublisher(db: Db, name = "Fieldnotes Press") {
  const user = await createUser(db);
  const admin = await createUser(db, { role: "admin" });
  const slug = `press-${randomUUID().slice(0, 12)}`;
  const applied = await applyToPublish(db, user, {
    displayName: name,
    slug,
    bio: "An independent press publishing field guides and essays about rivers and places.",
    website: "https://example.com",
    rightsConfirmed: true,
  });
  if (!applied.ok) throw new Error(`apply failed: ${applied.code}`);
  const reviewed = await reviewPublisherApplication(db, admin, {
    profileId: applied.profileId,
    action: "approve",
  });
  if (!reviewed.ok) throw new Error("approve failed");
  const [refreshed] = await db.select().from(users).where(eq(users.id, user.id));
  return { user: refreshed!, admin, profileId: applied.profileId, slug };
}

/** Admission and completion of a book file, as UploadThing's middleware and callback would. */
async function uploadSource(
  db: Db,
  userId: string,
  bookId: string,
  options: { title?: string; name?: string; size?: number } = {},
) {
  const file = {
    name: options.name ?? "field-notes.pdf",
    size: options.size ?? 2000,
    type: "application/pdf",
  };
  const admitted = await prepareBookUpload(db, { userId, bookId, kind: "source", files: [file] });
  if (!admitted.ok) return admitted;
  return completeBookSourceUpload(db, {
    userId,
    bookId,
    title: options.title,
    file: { ...file, key: `book-${randomUUID()}`, customId: admitted.customId },
    embedding: EMBEDDING,
    acl: "public",
  });
}

async function markReady(db: Db, versionId: string) {
  await db
    .update(documentVersions)
    .set({ status: "ready", pageCount: 12 })
    .where(eq(documentVersions.id, versionId));
}

const categorySlugs = async (db: Db) =>
  (await db.select({ slug: categories.slug }).from(categories).orderBy(categories.slug)).map(
    (row) => row.slug,
  );

function submission(bookId: string, overrides: Partial<BookSubmissionInput> = {}) {
  return {
    bookId,
    title: "Field Notes on River Restoration",
    author: "Ada Rivers",
    description:
      "A practical guide to restoring urban rivers, with case studies from three cities and notes on planting.",
    language: "en",
    categories: ["environment"],
    licenseStatement: "Published under CC BY 4.0 by the author, who holds the rights.",
    rightsConfirmed: true as const,
    ...overrides,
  } satisfies BookSubmissionInput;
}

/** A published book with one approved revision, through the real journey. */
async function publishedBook(
  db: Db,
  publisher: Awaited<ReturnType<typeof approvedPublisher>>,
  overrides: Partial<BookSubmissionInput> = {},
) {
  const created = await createBook(db, publisher.user);
  if (!created.ok) throw new Error(created.code);
  const uploaded = await uploadSource(db, publisher.user.id, created.bookId);
  if (!uploaded.ok) throw new Error(uploaded.code);
  await markReady(db, uploaded.versionId);
  const submitted = await submitBook(db, publisher.user, submission(created.bookId, overrides));
  if (!submitted.ok) throw new Error(`${submitted.code} ${JSON.stringify(submitted.fieldErrors)}`);
  const approved = await decideSubmission(db, publisher.admin, {
    revisionId: uploaded.revisionId,
    action: "approve",
  });
  if (!approved.ok) throw new Error(approved.code);
  return { bookId: created.bookId, revisionId: uploaded.revisionId, versionId: uploaded.versionId };
}

describeWithDatabase("publishing (Section 6 journey)", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });

  it("grants the publisher role only through an admin's approval", async () => {
    const unverified = await createUser(db, { emailVerified: false });
    const application = {
      displayName: "Open Chapters",
      slug: `open-${randomUUID().slice(0, 8)}`,
      bio: "We publish open textbooks for students and teachers in many subjects worldwide.",
      rightsConfirmed: true as const,
    };
    expect(await applyToPublish(db, unverified, application)).toEqual({
      ok: false,
      code: "email_unverified",
    });
    const admin = await createUser(db, { role: "admin" });
    expect(await applyToPublish(db, admin, application)).toEqual({
      ok: false,
      code: "admin_account",
    });

    const reader = await createUser(db);
    const applied = await applyToPublish(db, reader, application);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    // Applying changes no role, and a pending applicant can't act as a publisher.
    const [pending] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, reader.id));
    expect(pending?.role).toBe("reader");
    expect(await createBook(db, reader)).toEqual({ ok: false, code: "not_publisher" });
    expect(await applyToPublish(db, reader, application)).toEqual({
      ok: false,
      code: "already_applied",
    });

    // Another applicant can't take the same address.
    const other = await createUser(db);
    expect(await applyToPublish(db, other, application)).toEqual({ ok: false, code: "slug_taken" });

    const rejected = await reviewPublisherApplication(db, admin, {
      profileId: applied.profileId,
      action: "reject",
      reason: "Please describe the rights you hold.",
    });
    expect(rejected.ok).toBe(true);
    const [afterReject] = await db
      .select({ status: publisherProfiles.status, reason: publisherProfiles.reviewReason })
      .from(publisherProfiles)
      .where(eq(publisherProfiles.id, applied.profileId));
    expect(afterReject).toEqual({
      status: "rejected",
      reason: "Please describe the rights you hold.",
    });

    // Reapply, then approval grants the role, writes audits and queues a notice.
    expect((await applyToPublish(db, reader, application)).ok).toBe(true);
    const approved = await reviewPublisherApplication(db, admin, {
      profileId: applied.profileId,
      action: "approve",
    });
    expect(approved.ok).toBe(true);
    expect(
      await reviewPublisherApplication(db, admin, {
        profileId: applied.profileId,
        action: "approve",
      }),
    ).toEqual({ ok: false, code: "already_decided" });
    const [granted] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, reader.id));
    expect(granted?.role).toBe("publisher");
    const audits = await db.execute<{ action: string }>(sql`
      select action from audit_logs where target_id in (${applied.profileId}, ${reader.id}) order by created_at`);
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "publisher.applied",
        "publisher.rejected",
        "publisher.approved",
        "user.role_granted",
      ]),
    );
    if (!approved.ok) return;
    const [event] = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.eventKey, approved.eventKeys[0]!));
    expect(event?.payload).toMatchObject({ type: "publisher_approved", userId: reader.id });
    const notice = await createNotification(db, {
      userId: reader.id,
      type: "publisher_approved",
      subjectId: applied.profileId,
      eventKey: approved.eventKeys[0]!,
    });
    expect(notice.created).toBe(true);
  });

  it("keeps book files out of the personal allowance and enforces the publishing one", async () => {
    const publisher = await approvedPublisher(db);
    const created = await createBook(db, publisher.user);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const uploaded = await uploadSource(db, publisher.user.id, created.bookId, {
      title: "River Notes",
    });
    expect(uploaded.ok).toBe(true);
    expect(await ownedSourceCount(db, publisher.user.id)).toBe(0);
    expect(await storageBytesUsed(db, publisher.user.id)).toBe(0);

    // 250 MiB of book files at most.
    const huge = await prepareBookUpload(db, {
      userId: publisher.user.id,
      bookId: created.bookId,
      kind: "source",
      files: [{ name: "big.pdf", size: 21 * 1024 * 1024, type: "application/pdf" }],
    });
    expect(huge).toEqual({ ok: false, code: "file_too_large" });
    // A cover must be an image; another publisher's book is not found.
    const notImage = await prepareBookUpload(db, {
      userId: publisher.user.id,
      bookId: created.bookId,
      kind: "cover",
      files: [{ name: "cover.gif", size: 100, type: "image/gif" }],
    });
    expect(notImage).toEqual({ ok: false, code: "not_image" });
    const stranger = await approvedPublisher(db, "Other Press");
    const foreign = await prepareBookUpload(db, {
      userId: stranger.user.id,
      bookId: created.bookId,
      kind: "source",
      files: [{ name: "x.pdf", size: 10, type: "application/pdf" }],
    });
    expect(foreign).toEqual({ ok: false, code: "not_found" });

    // Ten book uploads a day.
    for (let index = 0; index < 9; index += 1) {
      expect((await uploadSource(db, publisher.user.id, created.bookId)).ok).toBe(true);
    }
    expect(await uploadSource(db, publisher.user.id, created.bookId)).toEqual({
      ok: false,
      code: "daily_limit",
    });
    // Replacing the draft's source revoked each replaced, unreferenced document.
    const [active] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count from documents
      where owner_id = ${publisher.user.id} and status = 'active'`);
    expect(Number(active?.count)).toBe(1);
  });

  it("isolates revisions: pending is invisible, approval swaps the live revision atomically", async () => {
    const publisher = await approvedPublisher(db);
    const reader = await createUser(db);
    const created = await createBook(db, publisher.user);
    if (!created.ok) throw new Error(created.code);
    const first = await uploadSource(db, publisher.user.id, created.bookId);
    if (!first.ok) throw new Error(first.code);

    // Incomplete metadata and a processing source can't be submitted.
    const incomplete = await submitBook(
      db,
      publisher.user,
      submission(created.bookId, { description: "Short" }),
    );
    expect(incomplete).toMatchObject({
      ok: false,
      code: "incomplete",
      fieldErrors: { description: expect.any(Array) },
    });
    expect(await submitBook(db, publisher.user, submission(created.bookId))).toEqual({
      ok: false,
      code: "source_processing",
    });
    await markReady(db, first.versionId);
    expect((await submitBook(db, publisher.user, submission(created.bookId))).ok).toBe(true);

    // Pending: not public, not readable by others, locked for editing.
    expect(await getPublicBook(db, created.bookId)).toBeNull();
    expect(await canReadDocumentVersion(db, reader, first.versionId)).toBe(false);
    expect(
      await saveBookDraft(db, publisher.user, {
        bookId: created.bookId,
        title: "Changed",
        author: "",
        description: "",
        language: "en",
        categories: [],
        licenseStatement: "",
      }),
    ).toEqual({ ok: false, code: "pending" });
    const ids = await searchCatalogIds(db, {
      q: "river restoration",
      categories: [],
      sort: "relevance",
      page: 1,
      pageSize: 24,
    });
    expect(ids.ids).not.toContain(created.bookId);

    // Withdraw and resubmit work; the moderator sees it in the queue.
    expect((await withdrawSubmission(db, publisher.user, created.bookId)).ok).toBe(true);
    expect((await submitBook(db, publisher.user, submission(created.bookId))).ok).toBe(true);
    const queue = await listSubmissions(db, { status: "open", limit: 100 });
    expect(queue.items.map((row) => row.id)).toContain(first.revisionId);
    expect(await submissionSourceFile(db, first.revisionId)).toMatchObject({
      fileKey: expect.any(String),
    });

    // Reject leaves nothing live and returns the book to draft.
    const rejected = await decideSubmission(db, publisher.admin, {
      revisionId: first.revisionId,
      action: "reject",
      reason: "The license statement must name the rights holder.",
    });
    expect(rejected).toMatchObject({ ok: true, catalogChanged: false });
    const afterReject = await getPublisherBook(db, publisher.user, created.bookId);
    expect(afterReject).toMatchObject({
      status: "draft",
      listingStatus: "rejected",
      lastDecision: {
        status: "rejected",
        reason: "The license statement must name the rights holder.",
      },
      can: { revise: true, submit: false },
    });

    // Revise and resubmit as revision 2, then approve.
    const revised = await reviseBook(db, publisher.user, created.bookId);
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect((await submitBook(db, publisher.user, submission(created.bookId))).ok).toBe(true);
    const approved = await decideSubmission(db, publisher.admin, {
      revisionId: revised.revisionId,
      action: "approve",
    });
    expect(approved).toMatchObject({ ok: true, catalogChanged: true });
    if (!approved.ok) return;
    const live = await getPublicBook(db, created.bookId);
    expect(live).toMatchObject({ revisionId: revised.revisionId, versionId: first.versionId });
    expect(await canReadDocumentVersion(db, reader, first.versionId)).toBe(true);
    const keys = await db
      .select({ name: outboxEvents.topic })
      .from(outboxEvents)
      .where(inArray(outboxEvents.eventKey, approved.eventKeys));
    expect(keys.map((row) => row.name).sort()).toEqual(
      [EVENT_NAMES.catalogBookPublished, EVENT_NAMES.notificationCreated].sort(),
    );

    // An update with a new PDF stays pending while the approved one stays live.
    const update = await reviseBook(db, publisher.user, created.bookId);
    if (!update.ok) throw new Error(update.code);
    const replacement = await uploadSource(db, publisher.user.id, created.bookId);
    if (!replacement.ok) throw new Error(replacement.code);
    await markReady(db, replacement.versionId);
    expect(
      (
        await submitBook(
          db,
          publisher.user,
          submission(created.bookId, { title: "Field Notes, Second Edition" }),
        )
      ).ok,
    ).toBe(true);
    expect((await getPublicBook(db, created.bookId))?.title).toBe(
      "Field Notes on River Restoration",
    );
    expect(await canReadDocumentVersion(db, reader, replacement.versionId)).toBe(false);
    // The live source stays because the approved revision references it.
    const [oldDoc] = await db
      .select({ status: documents.status })
      .from(documents)
      .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
      .where(eq(documentVersions.id, first.versionId));
    expect(oldDoc?.status).toBe("active");

    await decideSubmission(db, publisher.admin, {
      revisionId: update.revisionId,
      action: "approve",
    });
    const swapped = await getPublicBook(db, created.bookId);
    expect(swapped).toMatchObject({
      title: "Field Notes, Second Edition",
      versionId: replacement.versionId,
    });
    // The previous version is no longer reachable through the catalog.
    expect(await canReadDocumentVersion(db, reader, first.versionId)).toBe(false);
    expect(await canReadDocumentVersion(db, reader, replacement.versionId)).toBe(true);
  });

  it("never lets a publisher touch another publisher's book", async () => {
    const owner = await approvedPublisher(db);
    const other = await approvedPublisher(db, "Elsewhere Books");
    const book = await publishedBook(db, owner);
    expect(await getPublisherBook(db, other.user, book.bookId)).toBeNull();
    expect(await unpublishBook(db, other.user, book.bookId)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(await reviseBook(db, other.user, book.bookId)).toEqual({ ok: false, code: "not_found" });
    expect(await withdrawSubmission(db, other.user, book.bookId)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(await deleteBookDraft(db, other.user, book.bookId)).toEqual({
      ok: false,
      code: "not_found",
    });
    const list = await listPublisherBooks(db, {
      publisherId: other.profileId,
      status: "all",
      limit: 50,
    });
    expect(list.items.map((row) => row.id)).not.toContain(book.bookId);
    // A reader (not a publisher) has no access at all.
    const reader = await createUser(db);
    expect(await getPublisherBook(db, reader, book.bookId)).toBeNull();
  });

  it("takedown removes catalog presence and reading access at once, and resolves reports", async () => {
    const publisher = await approvedPublisher(db);
    const book = await publishedBook(db, publisher);
    const reader = await createUser(db);
    const reporter = await createUser(db);
    const dedupe = { redis: null, keys: cacheKeys("test") };
    expect(await setBookSaved(db, dedupe, reader, { bookId: book.bookId, saved: true })).toEqual({
      ok: true,
      saved: true,
    });

    expect(
      await reportBook(db, publisher.user, { bookId: book.bookId, reason: "copyright" }),
    ).toEqual({
      ok: false,
      code: "cannot_report",
    });
    const report = await reportBook(db, reporter, {
      bookId: book.bookId,
      reason: "copyright",
      details: "This is a chapter from a book I published in 2019.",
    });
    expect(report.ok).toBe(true);
    expect(
      await reportBook(db, reporter, {
        bookId: book.bookId,
        reason: "other",
        details: "Again please",
      }),
    ).toEqual({
      ok: false,
      code: "already_reported",
    });
    const reports = await listReports(db, { status: "open", limit: 100 });
    expect(reports.items.find((row) => row.bookId === book.bookId)).toMatchObject({
      reason: "copyright",
      bookStatus: "published",
    });
    expect((await bookViewerState(db, reporter.id, book.bookId)).report?.status).toBe("open");

    const takedown = await takedownBook(db, publisher.admin, {
      bookId: book.bookId,
      reason: "Rights holder confirmed the copyright claim.",
    });
    expect(takedown).toMatchObject({ ok: true, catalogChanged: true });
    expect(await getPublicBook(db, book.bookId)).toBeNull();
    expect(await canReadDocumentVersion(db, reader, book.versionId)).toBe(false);
    expect((await catalogCards(db, [book.bookId])).length).toBe(0);
    const [resolved] = await db
      .select({ status: contentReports.status, resolution: contentReports.resolution })
      .from(contentReports)
      .where(eq(contentReports.bookId, book.bookId));
    expect(resolved).toEqual({
      status: "resolved",
      resolution: "Rights holder confirmed the copyright claim.",
    });
    // The reader's save stays as a row but the book no longer shows anywhere.
    expect(await setBookSaved(db, dedupe, reader, { bookId: book.bookId, saved: true })).toEqual({
      ok: false,
      code: "not_found",
    });
    // A removed book can't be revised or uploaded to.
    expect(await reviseBook(db, publisher.user, book.bookId)).toEqual({
      ok: false,
      code: "removed",
    });
    expect(
      await takedownBook(db, publisher.admin, { bookId: book.bookId, reason: "Again, twice now." }),
    ).toEqual({
      ok: false,
      code: "already_decided",
    });
  });

  it("resolves or dismisses reports without touching the book", async () => {
    const publisher = await approvedPublisher(db);
    const book = await publishedBook(db, publisher);
    const reporter = await createUser(db);
    const report = await reportBook(db, reporter, {
      bookId: book.bookId,
      reason: "incorrect_metadata",
    });
    if (!report.ok) throw new Error(report.code);
    expect(
      await resolveReport(db, publisher.admin, { reportId: report.reportId, action: "dismiss" }),
    ).toEqual({ ok: true });
    expect(
      await resolveReport(db, publisher.admin, { reportId: report.reportId, action: "resolve" }),
    ).toEqual({ ok: false, code: "already_decided" });
    expect(await getPublicBook(db, book.bookId)).not.toBeNull();
    // A new report is allowed once the earlier one is closed.
    expect(
      (await reportBook(db, reporter, { bookId: book.bookId, reason: "inappropriate" })).ok,
    ).toBe(true);
  });

  it("unpublishes, locks the slug after the first approval, and deletes unpublished drafts", async () => {
    const publisher = await approvedPublisher(db);
    const profile = {
      displayName: "Fieldnotes Press",
      bio: "An independent press publishing field guides and essays about rivers and places.",
      website: undefined,
    };
    const renamed = `renamed-${randomUUID().slice(0, 8)}`;
    expect(
      await updatePublisherProfile(db, publisher.user, { ...profile, slug: renamed }),
    ).toMatchObject({
      ok: true,
    });
    const book = await publishedBook(db, publisher);
    expect(
      await updatePublisherProfile(db, publisher.user, {
        ...profile,
        slug: `again-${randomUUID().slice(0, 8)}`,
      }),
    ).toEqual({ ok: false, code: "slug_locked" });

    expect((await unpublishBook(db, publisher.user, book.bookId)).ok).toBe(true);
    expect(await getPublicBook(db, book.bookId)).toBeNull();
    expect(await deleteBookDraft(db, publisher.user, book.bookId)).toEqual({
      ok: false,
      code: "not_found",
    });

    const draft = await createBook(db, publisher.user);
    if (!draft.ok) throw new Error(draft.code);
    const uploaded = await uploadSource(db, publisher.user.id, draft.bookId);
    if (!uploaded.ok) throw new Error(uploaded.code);
    const deleted = await deleteBookDraft(db, publisher.user, draft.bookId);
    expect(deleted).toMatchObject({ ok: true, fileKeys: [expect.any(String)] });
    const [book2] = await db
      .select({ deletedAt: books.deletedAt })
      .from(books)
      .where(eq(books.id, draft.bookId));
    expect(book2?.deletedAt).not.toBeNull();
  });

  it("attaches covers to the draft only", async () => {
    const publisher = await approvedPublisher(db);
    const created = await createBook(db, publisher.user);
    if (!created.ok) throw new Error(created.code);
    const admittedEarly = await prepareBookUpload(db, {
      userId: publisher.user.id,
      bookId: created.bookId,
      kind: "cover",
      files: [{ name: "c.png", size: 100, type: "image/png" }],
    });
    expect(admittedEarly).toEqual({ ok: false, code: "no_source" });
    const uploaded = await uploadSource(db, publisher.user.id, created.bookId);
    if (!uploaded.ok) throw new Error(uploaded.code);
    const file = { name: "c.png", size: 100, type: "image/png" };
    const admitted = await prepareBookUpload(db, {
      userId: publisher.user.id,
      bookId: created.bookId,
      kind: "cover",
      files: [file],
    });
    if (!admitted.ok) throw new Error(admitted.code);
    const cover = await completeCoverUpload(db, {
      userId: publisher.user.id,
      bookId: created.bookId,
      file: { ...file, key: `cover-${randomUUID()}`, customId: admitted.customId },
    });
    expect(cover.ok).toBe(true);
    const view = await getPublisherBook(db, publisher.user, created.bookId);
    expect(view?.open?.coverKey).toMatch(/^cover-/);
    // The intent was used: completing again is refused.
    const again = await completeCoverUpload(db, {
      userId: publisher.user.id,
      bookId: created.bookId,
      file: { ...file, key: `cover-${randomUUID()}`, customId: admitted.customId },
    });
    expect(again).toEqual({ ok: false, code: "upload_expired" });
    const [intent] = await db
      .select({ status: uploadIntents.status })
      .from(uploadIntents)
      .where(eq(uploadIntents.customId, admitted.customId));
    expect(intent?.status).toBe("completed");
  });

  it("follows, notifies only opted-in followers of the live revision, and counts stats", async () => {
    const publisher = await approvedPublisher(db);
    const quiet = await createUser(db);
    const eager = await createUser(db);
    expect(
      await setFollow(db, publisher.user, { publisherId: publisher.profileId, following: true }),
    ).toEqual({
      ok: false,
      code: "cannot_follow",
    });
    expect(
      await setFollow(db, eager, { publisherId: publisher.profileId, following: true }),
    ).toEqual({
      ok: true,
      following: true,
      notify: true,
    });
    await setFollow(db, quiet, {
      publisherId: publisher.profileId,
      following: true,
      notify: false,
    });
    const book = await publishedBook(db, publisher);
    const followers = await followersToNotify(db, {
      publisherId: publisher.profileId,
      revisionId: book.revisionId,
      limit: 100,
    });
    expect(followers.userIds).toEqual([eager.id]);
    const notice = await createNotification(db, {
      userId: eager.id,
      type: "publisher_new_book",
      subjectId: book.revisionId,
      eventKey: `book-published:${book.revisionId}:${eager.id}`,
    });
    expect(notice.created).toBe(true);
    // Unfollowing before delivery means no notice.
    await setFollow(db, eager, { publisherId: publisher.profileId, following: false });
    const late = await createNotification(db, {
      userId: eager.id,
      type: "publisher_new_book",
      subjectId: book.revisionId,
      eventKey: `book-published:${book.revisionId}:${eager.id}:2`,
    });
    expect(late).toEqual({ created: false, skipped: "subject_gone" });

    const stats = await publisherStats(db, publisher.profileId);
    expect(stats).toMatchObject({ followers: 1, reads: 0, saves: 0 });
    expect(stats.books.map((row) => row.id)).toEqual([book.bookId]);
  });
});

describe.skipIf(!inject("databaseReady") || !inject("redisReady"))("catalog analytics", () => {
  it("records one read and one save per reader, book and day", async () => {
    const db = testDb();
    const redis = createRedis({ ...TEST_REDIS, retries: 0 });
    const dedupe = { redis, keys: cacheKeys("test") };
    const publisher = await approvedPublisher(db);
    const book = await publishedBook(db, publisher);
    const reader = await createUser(db);
    const now = new Date();
    expect(
      await recordBookRead(db, dedupe, { userId: reader.id, versionId: book.versionId, now }),
    ).toBe(true);
    expect(
      await recordBookRead(db, dedupe, { userId: reader.id, versionId: book.versionId, now }),
    ).toBe(false);
    // The publisher reading their own book isn't counted.
    expect(
      await recordBookRead(db, dedupe, {
        userId: publisher.user.id,
        versionId: book.versionId,
        now,
      }),
    ).toBe(false);
    await setBookSaved(db, dedupe, reader, { bookId: book.bookId, saved: true, now });
    await setBookSaved(db, dedupe, reader, { bookId: book.bookId, saved: false, now });
    await setBookSaved(db, dedupe, reader, { bookId: book.bookId, saved: true, now });
    const [row] = await db
      .select({ reads: analyticsDaily.reads, saves: analyticsDaily.saves })
      .from(analyticsDaily)
      .where(eq(analyticsDaily.bookId, book.bookId));
    expect(row).toEqual({ reads: 1, saves: 1 });
    const [saved] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(libraryItems)
      .where(and(eq(libraryItems.userId, reader.id), eq(libraryItems.bookId, book.bookId)));
    expect(Number(saved?.count)).toBe(1);
    expect((await publisherStats(db, publisher.profileId)).reads).toBe(1);
  });
});

describeWithDatabase("catalog search (Section 24)", () => {
  let db: Db;
  let marker: string;
  let ids: Record<string, string>;
  beforeAll(async () => {
    db = testDb();
    // Letters only, so full-text search keeps it as one word.
    marker = `zq${randomUUID()
      .replace(/-/g, "")
      .slice(0, 8)
      .replace(/[0-9]/g, (digit) => "ghijklmnop"[Number(digit)]!)}`;
    const publisher = await approvedPublisher(db, `Marker ${marker} Press`);
    const slugs = await categorySlugs(db);
    expect(slugs).toEqual(expect.arrayContaining(["design", "environment", "research"]));
    const make = (
      title: string,
      author: string,
      description: string,
      category: string,
      language = "en",
    ) =>
      publishedBook(db, publisher, {
        title,
        author,
        description: `${description} ${"Filler words describe the book in more detail for readers. ".repeat(1)}`,
        categories: [category],
        language: language as BookSubmissionInput["language"],
      });
    ids = {
      titleHit: (
        await make(
          `Wetlands ${marker}`,
          "Jo Lake",
          "About marshes and their birds and plants.",
          "environment",
        )
      ).bookId,
      descHit: (
        await make(
          "Bird Atlas",
          "Kim Shore",
          `A note mentions wetlands ${marker} once in passing here.`,
          "environment",
        )
      ).bookId,
      authorHit: (
        await make(
          "Margins and Grids",
          `Wetlands ${marker} Author`,
          "Typography for books and pages.",
          "design",
        )
      ).bookId,
      spanish: (
        await make(
          "Ríos y ciudades",
          "Ana Río",
          "Un libro sobre ríos urbanos y su restauración.",
          "research",
          "es",
        )
      ).bookId,
    };
  });

  it("ranks title over author over description with ts_rank_cd weights", async () => {
    const result = await searchCatalogIds(db, {
      q: `wetlands ${marker}`,
      categories: [],
      sort: "relevance",
      page: 1,
      pageSize: 24,
    });
    expect(result.total).toBe(3);
    expect(result.ids).toEqual([ids.titleHit, ids.authorHit, ids.descHit]);
  });

  it("falls back to trigram similarity on a typo", async () => {
    const typo = await searchCatalogIds(db, {
      q: "Margns and Grds",
      categories: [],
      publisherSlug: undefined,
      sort: "relevance",
      page: 1,
      pageSize: 24,
    });
    expect(typo.ids).toContain(ids.authorHit);
    const nothing = await searchCatalogIds(db, {
      q: "qqqzzzxxyy",
      categories: [],
      sort: "relevance",
      page: 1,
      pageSize: 24,
    });
    expect(nothing).toEqual({ ids: [], total: 0 });
  });

  it("combines filters with deterministic pages", async () => {
    const env = await searchCatalogIds(db, {
      q: marker,
      categories: ["environment"],
      sort: "title",
      page: 1,
      pageSize: 24,
    });
    expect(env.ids).toEqual([ids.descHit, ids.titleHit]);
    const spanish = await searchCatalogIds(db, {
      categories: [],
      language: "es",
      sort: "newest",
      page: 1,
      pageSize: 24,
    });
    expect(spanish.ids).toContain(ids.spanish);
    expect(spanish.ids).not.toContain(ids.titleHit);

    // Page through everything one at a time: no repeats, no gaps, stable order.
    const all = await searchCatalogIds(db, {
      categories: [],
      sort: "newest",
      page: 1,
      pageSize: 1000,
    });
    const seen: string[] = [];
    for (let page = 1; page <= Math.ceil(all.total / 7); page += 1) {
      const slice = await searchCatalogIds(db, {
        categories: [],
        sort: "newest",
        page,
        pageSize: 7,
      });
      expect(slice.total).toBe(all.total);
      seen.push(...slice.ids);
    }
    expect(seen).toEqual(all.ids);
    const beyond = await searchCatalogIds(db, {
      categories: [],
      sort: "newest",
      page: 999,
      pageSize: 24,
    });
    expect(beyond.ids).toEqual([]);
  });

  it("builds facets from published books only", async () => {
    const facets = await loadFacets(db);
    expect(facets.languages.map((row) => row.code)).toEqual(expect.arrayContaining(["en", "es"]));
    expect(facets.languages.find((row) => row.code === "es")?.name).toBe("Spanish");
    expect(facets.publishers.find((row) => row.name === `Marker ${marker} Press`)?.count).toBe(4);
  });
});
