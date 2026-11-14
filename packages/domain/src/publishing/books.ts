import {
  bookSubmissionSchema,
  PUBLISHER_BOOK_LIMIT,
  type BookDraftValues,
  type BookRevisionStatus,
  type BookStatus,
  type BookSubmissionInput,
  type PublishingListStatus,
} from "@foliomind/contracts";
import {
  bookRevisionCategories,
  bookRevisions,
  books,
  categories,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../access";
import { writeAudit } from "../audit";
import { keysetPage, keysetPlan, likePattern, type KeysetPage } from "../keyset";
import {
  activeBookCount,
  approvedPublisherFor,
  getOwnedBook,
  openRevision,
  releaseUnusedBookFiles,
  type RevisionRecord,
} from "./records";

/*
 * Book drafts and submissions on the Publisher Dashboard (blueprint Sections
 * 5 row 12, 6 "Publishing", 11 and 28). A book has at most one open revision
 * (draft or pending) next to its approved, live one; a new revision never
 * replaces the live one until a moderator approves it.
 */

export type ListingStatus = Exclude<PublishingListStatus, "all"> | "removed";

/** What the publisher sees for a book, from its own status and its newest revision. */
const listingStatusSql = sql`case
  when b.status = 'removed' then 'removed'
  when lr.status = 'pending' then 'pending'
  when lr.status = 'rejected' then 'rejected'
  when b.status = 'published' then 'published'
  when b.status = 'unpublished' then 'unpublished'
  else 'draft' end`;

export interface PublisherBookRow {
  id: string;
  title: string;
  status: BookStatus;
  listingStatus: ListingStatus;
  /** A published book with changes waiting or being edited. */
  live: boolean;
  latestRevisionStatus: BookRevisionStatus | null;
  coverKey: string | null;
  updatedAt: Date;
}

/** Publisher Dashboard list (Section 24): title, status, recently updated, keyset pages. */
export async function listPublisherBooks(
  db: Executor,
  query: {
    publisherId: string;
    q?: string | undefined;
    status: PublishingListStatus;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<PublisherBookRow>> {
  const plan = keysetPlan({
    sortKey: sql`b.updated_at`,
    idColumn: sql`b.id`,
    ascending: false,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [sql`b.publisher_id = ${query.publisherId}`, sql`b.deleted_at is null`];
  if (query.q) filters.push(sql`coalesce(lr.title, '') ilike ${likePattern(query.q)}`);
  if (query.status !== "all") filters.push(sql`(${listingStatusSql}) = ${query.status}`);
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    title: string | null;
    status: BookStatus;
    listing_status: ListingStatus;
    published_revision_id: string | null;
    latest_status: BookRevisionStatus | null;
    cover_key: string | null;
    updated_at: string;
    sort_value: string;
  }>(sql`
    select b.id, lr.title, b.status, b.published_revision_id, lr.status as latest_status,
      (${listingStatusSql}) as listing_status, ca.file_key as cover_key,
      b.updated_at, b.updated_at::text as sort_value
    from books b
    left join lateral (
      select br.title, br.status, br.cover_asset_id from book_revisions br
      where br.book_id = b.id order by br.revision_no desc limit 1
    ) lr on true
    left join assets ca on ca.id = lr.cover_asset_id and ca.state = 'ready'
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    title: row.title ?? "Untitled book",
    status: row.status,
    listingStatus: row.listing_status,
    live: row.status === "published",
    latestRevisionStatus: row.latest_status,
    coverKey: row.cover_key,
    updatedAt: new Date(row.updated_at),
  }));
}

export interface BookSourceView {
  documentId: string;
  versionId: string;
  fileName: string;
  status: string;
  pageCount: number | null;
  /** The newest ingestion job, for progress polling. */
  jobId: string | null;
}

export interface BookRevisionView {
  id: string;
  revisionNo: number;
  status: BookRevisionStatus;
  title: string;
  author: string;
  description: string;
  language: string;
  categories: string[];
  licenseStatement: string;
  coverKey: string | null;
  reviewReason: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  source: BookSourceView;
}

export interface PublisherBookView {
  id: string;
  status: BookStatus;
  listingStatus: ListingStatus;
  /** The revision being edited or reviewed. */
  open: BookRevisionView | null;
  /** The approved revision readers see. */
  live: BookRevisionView | null;
  /** The newest decided revision, for feedback such as a rejection reason. */
  lastDecision: {
    revisionNo: number;
    status: "approved" | "rejected";
    reason: string | null;
    decidedAt: Date;
  } | null;
  history: {
    id: string;
    revisionNo: number;
    status: BookRevisionStatus;
    reviewReason: string | null;
    updatedAt: Date;
  }[];
  can: {
    edit: boolean;
    uploadSource: boolean;
    submit: boolean;
    withdraw: boolean;
    revise: boolean;
    unpublish: boolean;
    delete: boolean;
  };
}

async function revisionViews(
  db: Executor,
  revisionIds: string[],
): Promise<Map<string, BookRevisionView>> {
  if (revisionIds.length === 0) return new Map();
  const rows = await db.execute<{
    id: string;
    revision_no: number;
    status: BookRevisionStatus;
    title: string;
    author: string;
    description: string;
    language: string;
    license_statement: string;
    cover_key: string | null;
    review_reason: string | null;
    published_at: string | null;
    updated_at: string;
    document_id: string;
    version_id: string;
    file_name: string;
    version_status: string;
    page_count: number | null;
    job_id: string | null;
    category_slugs: string[];
  }>(sql`
    select br.id, br.revision_no, br.status, br.title, br.author, br.description, br.language,
      br.license_statement, ca.file_key as cover_key, br.review_reason, br.published_at, br.updated_at,
      d.id as document_id, v.id as version_id, d.title as file_name, v.status::text as version_status,
      v.page_count,
      (select j.id from jobs j where j.kind = 'ingest-document' and j.target_id = v.id
        order by j.created_at desc limit 1) as job_id,
      coalesce((select json_agg(c.slug order by c.name) from book_revision_categories brc
        join categories c on c.id = brc.category_id where brc.book_revision_id = br.id), '[]'::json)
        as category_slugs
    from book_revisions br
    join document_versions v on v.id = br.document_version_id
    join documents d on d.id = v.document_id
    left join assets ca on ca.id = br.cover_asset_id and ca.state = 'ready'
    where br.id in (${sql.join(
      revisionIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        revisionNo: Number(row.revision_no),
        status: row.status,
        title: row.title,
        author: row.author,
        description: row.description,
        language: row.language,
        categories: row.category_slugs,
        licenseStatement: row.license_statement,
        coverKey: row.cover_key,
        reviewReason: row.review_reason,
        publishedAt: row.published_at ? new Date(row.published_at) : null,
        updatedAt: new Date(row.updated_at),
        source: {
          documentId: row.document_id,
          versionId: row.version_id,
          fileName: row.file_name,
          status: row.version_status,
          pageCount: row.page_count === null ? null : Number(row.page_count),
          jobId: row.job_id,
        },
      },
    ]),
  );
}

/** The book editor on the Publisher Dashboard; null unless the actor's publisher owns it. */
export async function getPublisherBook(
  db: Executor,
  actor: Actor,
  bookId: string,
): Promise<PublisherBookView | null> {
  const publisher = await approvedPublisherFor(db, actor);
  if (!publisher) return null;
  const book = await getOwnedBook(db, publisher.id, bookId);
  if (!book) return null;
  const history = await db.execute<{
    id: string;
    revision_no: number;
    status: BookRevisionStatus;
    review_reason: string | null;
    updated_at: string;
  }>(sql`
    select id, revision_no, status, review_reason, updated_at from book_revisions
    where book_id = ${book.id} order by revision_no desc`);
  const open = history.find((row) => row.status === "draft" || row.status === "pending");
  const decided = history.find((row) => row.status === "approved" || row.status === "rejected");
  const latest = history[0];
  const ids = [open?.id, book.publishedRevisionId].filter((id): id is string => Boolean(id));
  const views = await revisionViews(db, ids);
  const openView = open ? (views.get(open.id) ?? null) : null;
  const removed = book.status === "removed";
  const listingStatus: ListingStatus = removed
    ? "removed"
    : latest?.status === "pending"
      ? "pending"
      : latest?.status === "rejected"
        ? "rejected"
        : book.status === "published"
          ? "published"
          : book.status === "unpublished"
            ? "unpublished"
            : "draft";
  const neverPublished = book.publishedRevisionId === null;
  return {
    id: book.id,
    status: book.status,
    listingStatus,
    open: openView,
    live: book.publishedRevisionId ? (views.get(book.publishedRevisionId) ?? null) : null,
    lastDecision: decided
      ? {
          revisionNo: Number(decided.revision_no),
          status: decided.status as "approved" | "rejected",
          reason: decided.review_reason,
          decidedAt: new Date(decided.updated_at),
        }
      : null,
    history: history.map((row) => ({
      id: row.id,
      revisionNo: Number(row.revision_no),
      status: row.status,
      reviewReason: row.review_reason,
      updatedAt: new Date(row.updated_at),
    })),
    can: {
      edit: !removed && openView?.status === "draft",
      uploadSource:
        !removed && (openView === null ? history.length === 0 : openView.status === "draft"),
      submit: !removed && openView?.status === "draft",
      withdraw: !removed && openView?.status === "pending",
      revise: !removed && openView === null && history.length > 0,
      unpublish: book.status === "published",
      delete: neverPublished && !removed && openView?.status !== "pending",
    },
  };
}

export type BookOutcome<T = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code:
        | "not_publisher"
        | "not_found"
        | "book_limit"
        | "removed"
        | "pending"
        | "no_source"
        | "source_processing"
        | "source_failed"
        | "incomplete"
        | "not_published"
        | "nothing_to_revise";
      fieldErrors?: Record<string, string[] | undefined>;
    };

/** "Add a book": an empty draft; its first revision appears when the PDF is uploaded. */
export async function createBook(
  db: Database,
  actor: Actor,
): Promise<BookOutcome<{ bookId: string }>> {
  return db.transaction(async (tx) => {
    const publisher = await approvedPublisherFor(tx, actor, { lock: true });
    if (!publisher) return { ok: false, code: "not_publisher" } as const;
    if ((await activeBookCount(tx, publisher.id)) >= PUBLISHER_BOOK_LIMIT) {
      return { ok: false, code: "book_limit" } as const;
    }
    const [book] = await tx
      .insert(books)
      .values({ publisherId: publisher.id, status: "draft" })
      .returning({ id: books.id });
    if (!book) throw new Error("Book was not created");
    await writeAudit(tx, {
      actorId: actor.id,
      action: "book.created",
      targetType: "book",
      targetId: book.id,
      metadata: { publisherId: publisher.id },
    });
    return { ok: true, bookId: book.id } as const;
  });
}

type DraftLock =
  | { error: "not_publisher" | "not_found" | "removed" | "no_source" | "pending" }
  | {
      error?: undefined;
      publisher: NonNullable<Awaited<ReturnType<typeof approvedPublisherFor>>>;
      book: NonNullable<Awaited<ReturnType<typeof getOwnedBook>>>;
      open: RevisionRecord;
    };

/** Locks the publisher's book and its open draft revision for an edit. */
async function lockDraft(tx: Executor, actor: Actor, bookId: string): Promise<DraftLock> {
  const publisher = await approvedPublisherFor(tx, actor);
  if (!publisher) return { error: "not_publisher" as const };
  const book = await getOwnedBook(tx, publisher.id, bookId, { lock: true });
  if (!book) return { error: "not_found" as const };
  if (book.status === "removed") return { error: "removed" as const };
  const open = await openRevision(tx, book.id, { lock: true });
  if (!open) return { error: "no_source" as const };
  if (open.status === "pending") return { error: "pending" as const };
  return { publisher, book, open };
}

async function writeDraft(tx: Executor, open: RevisionRecord, values: BookDraftValues) {
  const slugs = [...new Set(values.categories)];
  const found = slugs.length
    ? await tx
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
        .where(inArray(categories.slug, slugs))
    : [];
  await tx
    .update(bookRevisions)
    .set({
      title: values.title,
      author: values.author,
      description: values.description,
      language: values.language,
      licenseStatement: values.licenseStatement,
      updatedAt: sql`now()`,
    })
    .where(eq(bookRevisions.id, open.id));
  await tx.delete(bookRevisionCategories).where(eq(bookRevisionCategories.bookRevisionId, open.id));
  if (found.length > 0) {
    await tx
      .insert(bookRevisionCategories)
      .values(found.map((category) => ({ bookRevisionId: open.id, categoryId: category.id })));
  }
  await tx
    .update(books)
    .set({ updatedAt: sql`now()` })
    .where(eq(books.id, open.bookId));
  return found.length === slugs.length;
}

/** Save draft: lengths only, so a half-finished listing can be kept (Section 28). */
export async function saveBookDraft(
  db: Database,
  actor: Actor,
  values: BookDraftValues,
): Promise<BookOutcome> {
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, actor, values.bookId);
    if (locked.error) return { ok: false, code: locked.error } as const;
    await writeDraft(tx, locked.open, values);
    return { ok: true } as const;
  });
}

/**
 * Submit for review: saves the form, checks it against Section 28 and needs a
 * ready source, then moves the revision to `pending`. A published book stays
 * live on its approved revision meanwhile.
 */
export async function submitBook(
  db: Database,
  actor: Actor,
  input: BookSubmissionInput,
): Promise<BookOutcome> {
  if (!/^[0-9a-f-]{36}$/i.test(String(input.bookId))) return { ok: false, code: "not_found" };
  const parsed = bookSubmissionSchema.safeParse(input);
  return db.transaction(async (tx) => {
    const locked = await lockDraft(tx, actor, String(input.bookId));
    if (locked.error) return { ok: false, code: locked.error } as const;
    if (!parsed.success) {
      return {
        ok: false,
        code: "incomplete",
        fieldErrors: flatten(parsed.error),
      } as const;
    }
    const knownCategories = await writeDraft(tx, locked.open, parsed.data);
    if (!knownCategories) {
      return {
        ok: false,
        code: "incomplete",
        fieldErrors: { categories: ["Choose categories from the list."] },
      } as const;
    }
    const [version] = await tx.execute<{ status: string }>(sql`
      select status::text as status from document_versions where id = ${locked.open.documentVersionId}`);
    if (version?.status === "failed" || version?.status === "needs_ocr") {
      return { ok: false, code: "source_failed" } as const;
    }
    if (version?.status !== "ready") return { ok: false, code: "source_processing" } as const;

    await tx
      .update(bookRevisions)
      .set({ status: "pending", reviewedBy: null, reviewReason: null, updatedAt: sql`now()` })
      .where(eq(bookRevisions.id, locked.open.id));
    await tx
      .update(books)
      .set({
        status: locked.book.status === "draft" ? "pending" : locked.book.status,
        updatedAt: sql`now()`,
      })
      .where(eq(books.id, locked.book.id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "book.submitted",
      targetType: "book_revision",
      targetId: locked.open.id,
      metadata: { bookId: locked.book.id, revisionNo: locked.open.revisionNo },
    });
    return { ok: true } as const;
  });
}

function flatten(error: z.ZodError): Record<string, string[] | undefined> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/** Withdraw a submission still waiting for review; it becomes an editable draft again. */
export async function withdrawSubmission(
  db: Database,
  actor: Actor,
  bookId: string,
): Promise<BookOutcome> {
  return db.transaction(async (tx) => {
    const publisher = await approvedPublisherFor(tx, actor);
    if (!publisher) return { ok: false, code: "not_publisher" } as const;
    const book = await getOwnedBook(tx, publisher.id, bookId, { lock: true });
    if (!book) return { ok: false, code: "not_found" } as const;
    const open = await openRevision(tx, book.id, { lock: true });
    if (!open || open.status !== "pending") return { ok: false, code: "not_found" } as const;
    await tx
      .update(bookRevisions)
      .set({ status: "draft", updatedAt: sql`now()` })
      .where(eq(bookRevisions.id, open.id));
    await tx
      .update(books)
      .set({ status: book.status === "pending" ? "draft" : book.status, updatedAt: sql`now()` })
      .where(eq(books.id, book.id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "book.withdrawn",
      targetType: "book_revision",
      targetId: open.id,
      metadata: { bookId: book.id },
    });
    return { ok: true } as const;
  });
}

/**
 * Revise: a new draft revision copied from the newest one (after a rejection,
 * or to update a published listing). The live revision stays as it is.
 */
export async function reviseBook(
  db: Database,
  actor: Actor,
  bookId: string,
): Promise<BookOutcome<{ revisionId: string }>> {
  return db.transaction(async (tx) => {
    const publisher = await approvedPublisherFor(tx, actor);
    if (!publisher) return { ok: false, code: "not_publisher" } as const;
    const book = await getOwnedBook(tx, publisher.id, bookId, { lock: true });
    if (!book) return { ok: false, code: "not_found" } as const;
    if (book.status === "removed") return { ok: false, code: "removed" } as const;
    if (await openRevision(tx, book.id)) return { ok: false, code: "nothing_to_revise" } as const;
    const revision = await copyLatestRevision(tx, book.id);
    if (!revision) return { ok: false, code: "no_source" } as const;
    await tx
      .update(books)
      .set({ updatedAt: sql`now()` })
      .where(eq(books.id, book.id));
    return { ok: true, revisionId: revision } as const;
  });
}

/** Inserts revision n+1 as a draft copy of revision n (metadata, source, cover, categories). */
export async function copyLatestRevision(
  tx: Executor,
  bookId: string,
  override: { documentVersionId?: string; title?: string } = {},
): Promise<string | null> {
  const [created] = await tx.execute<{ id: string; source_id: string }>(sql`
    with latest as (
      select * from book_revisions where book_id = ${bookId} order by revision_no desc limit 1
    )
    insert into book_revisions (book_id, revision_no, document_version_id, title, description,
      author, language, cover_asset_id, license_statement, status)
    select book_id, revision_no + 1,
      coalesce(${override.documentVersionId ?? null}::uuid, document_version_id),
      coalesce(${override.title ?? null}, title), description, author, language,
      cover_asset_id, license_statement, 'draft'
    from latest
    returning id, (select id from latest) as source_id`);
  if (!created) return null;
  await tx.execute(sql`
    insert into book_revision_categories (book_revision_id, category_id)
    select ${created.id}::uuid, category_id from book_revision_categories
    where book_revision_id = ${created.source_id}`);
  return created.id;
}

/** Unpublish (Section 11): the listing leaves the catalog; a waiting submission returns to draft. */
export async function unpublishBook(
  db: Database,
  actor: Actor,
  bookId: string,
): Promise<BookOutcome<{ publisherSlug: string }>> {
  return db.transaction(async (tx) => {
    const publisher = await approvedPublisherFor(tx, actor);
    if (!publisher) return { ok: false, code: "not_publisher" } as const;
    const book = await getOwnedBook(tx, publisher.id, bookId, { lock: true });
    if (!book) return { ok: false, code: "not_found" } as const;
    if (book.status !== "published") return { ok: false, code: "not_published" } as const;
    await tx
      .update(books)
      .set({ status: "unpublished", updatedAt: sql`now()` })
      .where(eq(books.id, book.id));
    await tx
      .update(bookRevisions)
      .set({ status: "draft", updatedAt: sql`now()` })
      .where(and(eq(bookRevisions.bookId, book.id), eq(bookRevisions.status, "pending")));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "book.unpublished",
      targetType: "book",
      targetId: book.id,
      metadata: { publisherId: publisher.id },
    });
    return { ok: true, publisherSlug: publisher.slug } as const;
  });
}

/**
 * Delete a book that was never published (Section 11: source cleanup only when
 * unreferenced). Its unused source documents and covers are revoked; the
 * returned keys are removed from storage after the response.
 */
export async function deleteBookDraft(
  db: Database,
  actor: Actor,
  bookId: string,
): Promise<BookOutcome<{ fileKeys: string[] }>> {
  return db.transaction(async (tx) => {
    const publisher = await approvedPublisherFor(tx, actor);
    if (!publisher) return { ok: false, code: "not_publisher" } as const;
    const book = await getOwnedBook(tx, publisher.id, bookId, { lock: true });
    if (!book) return { ok: false, code: "not_found" } as const;
    if (book.publishedRevisionId || book.status === "removed") {
      return { ok: false, code: "not_found" } as const;
    }
    const open = await openRevision(tx, book.id);
    if (open?.status === "pending") return { ok: false, code: "pending" } as const;

    await tx
      .update(books)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(books.id, book.id));
    const files = await tx.execute<{ document_id: string; cover_asset_id: string | null }>(sql`
      select v.document_id, br.cover_asset_id from book_revisions br
      join document_versions v on v.id = br.document_version_id
      where br.book_id = ${book.id}`);
    const fileKeys = await releaseUnusedBookFiles(tx, {
      documentIds: files.map((row) => row.document_id),
      coverAssetIds: files.flatMap((row) => (row.cover_asset_id ? [row.cover_asset_id] : [])),
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "book.deleted",
      targetType: "book",
      targetId: book.id,
      metadata: { publisherId: publisher.id },
    });
    return { ok: true, fileKeys } as const;
  });
}

/** All categories, for the submission form's picker. */
export async function listCategories(db: Executor) {
  return db
    .select({ slug: categories.slug, name: categories.name })
    .from(categories)
    .orderBy(categories.name);
}
