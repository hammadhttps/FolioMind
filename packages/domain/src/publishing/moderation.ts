import { randomUUID } from "node:crypto";
import {
  EVENT_NAMES,
  type BookRevisionStatus,
  type BookStatus,
  type ReportReason,
  type ReportStatus,
} from "@foliomind/contracts";
import { bookRevisions, books, contentReports, type Database, type Executor } from "@foliomind/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Actor } from "../access";
import { writeAudit } from "../audit";
import { keysetPage, keysetPlan, likePattern, type KeysetPage } from "../keyset";
import { enqueue } from "../outbox";

/*
 * Content Moderation (blueprint Sections 4, 5 row 16, 6 "Publishing" and 28).
 * Admins review submitted, public-bound revisions (never private uploads),
 * approve or reject them with a reason, take down published books and resolve
 * reports. Approval swaps the live revision in one transaction; rejection
 * leaves the last approved revision live. Every decision is audited and the
 * publisher is told; followers hear about approvals through notify-followers.
 */

export interface SubmissionRow {
  id: string;
  bookId: string;
  revisionNo: number;
  title: string;
  author: string;
  publisherName: string;
  publisherSlug: string;
  status: BookRevisionStatus;
  /** An update to a book that's already live. */
  isUpdate: boolean;
  sourceStatus: string;
  reviewReason: string | null;
  updatedAt: Date;
}

export interface ReportRow {
  id: string;
  bookId: string;
  bookTitle: string;
  bookStatus: BookStatus;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Submissions queue (Section 24): oldest first while waiting, newest decided first otherwise. */
export async function listSubmissions(
  db: Executor,
  query: {
    status: "open" | "decided";
    q?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<SubmissionRow>> {
  const waiting = query.status === "open";
  const plan = keysetPlan({
    sortKey: sql`br.updated_at`,
    idColumn: sql`br.id`,
    ascending: waiting,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [
    waiting ? sql`br.status = 'pending'` : sql`br.status in ('approved', 'rejected')`,
    sql`b.deleted_at is null`,
  ];
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(sql`(br.title ilike ${pattern} or br.author ilike ${pattern})`);
  }
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    book_id: string;
    revision_no: number;
    title: string;
    author: string;
    publisher_name: string;
    publisher_slug: string;
    status: BookRevisionStatus;
    is_update: boolean;
    source_status: string;
    review_reason: string | null;
    updated_at: string;
    sort_value: string;
  }>(sql`
    select br.id, br.book_id, br.revision_no, br.title, br.author, p.display_name as publisher_name,
      p.slug as publisher_slug, br.status,
      (b.published_revision_id is not null and b.published_revision_id <> br.id) as is_update,
      v.status::text as source_status, br.review_reason, br.updated_at,
      br.updated_at::text as sort_value
    from book_revisions br
    join books b on b.id = br.book_id
    join publisher_profiles p on p.id = b.publisher_id
    join document_versions v on v.id = br.document_version_id
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    bookId: row.book_id,
    revisionNo: Number(row.revision_no),
    title: row.title,
    author: row.author,
    publisherName: row.publisher_name,
    publisherSlug: row.publisher_slug,
    status: row.status,
    isUpdate: row.is_update,
    sourceStatus: row.source_status,
    reviewReason: row.review_reason,
    updatedAt: new Date(row.updated_at),
  }));
}

/** Reports queue: open ones oldest first; decided ones newest first. Reporters stay anonymous. */
export async function listReports(
  db: Executor,
  query: {
    status: "open" | "decided";
    q?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<ReportRow>> {
  const waiting = query.status === "open";
  const plan = keysetPlan({
    sortKey: waiting ? sql`r.created_at` : sql`r.updated_at`,
    idColumn: sql`r.id`,
    ascending: waiting,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [waiting ? sql`r.status = 'open'` : sql`r.status in ('resolved', 'dismissed')`];
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(sql`(t.title ilike ${pattern} or t.author ilike ${pattern})`);
  }
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    book_id: string;
    title: string;
    book_status: BookStatus;
    reason: ReportReason;
    details: string | null;
    status: ReportStatus;
    resolution: string | null;
    created_at: string;
    updated_at: string;
    sort_value: string;
  }>(sql`
    select r.id, r.book_id, t.title, b.status as book_status, r.reason, r.details, r.status,
      r.resolution, r.created_at, r.updated_at,
      (${waiting ? sql`r.created_at` : sql`r.updated_at`})::text as sort_value
    from content_reports r
    join books b on b.id = r.book_id
    join lateral (
      select br.title, br.author from book_revisions br
      where br.id = coalesce(b.published_revision_id,
        (select id from book_revisions where book_id = b.id order by revision_no desc limit 1))
    ) t on true
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.title,
    bookStatus: row.book_status,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution: row.resolution,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function moderationCounts(db: Executor) {
  const [row] = await db.execute<{ submissions: number; reports: number }>(sql`
    select
      (select count(*)::int from book_revisions br join books b on b.id = br.book_id
        where br.status = 'pending' and b.deleted_at is null) as submissions,
      (select count(*)::int from content_reports where status = 'open') as reports`);
  return { submissions: Number(row?.submissions ?? 0), reports: Number(row?.reports ?? 0) };
}

export interface SubmissionDetail extends SubmissionRow {
  description: string;
  language: string;
  licenseStatement: string;
  categories: { slug: string; name: string }[];
  coverKey: string | null;
  bookStatus: BookStatus;
  source: { documentId: string; versionId: string; fileName: string; pageCount: number | null };
  /** The live revision this would replace, for comparison. */
  live: { revisionNo: number; title: string; description: string } | null;
}

/** A submitted revision for review; drafts are private to the publisher and never shown. */
export async function getSubmission(
  db: Executor,
  revisionId: string,
): Promise<SubmissionDetail | null> {
  const [row] = await db.execute<{
    id: string;
    book_id: string;
    revision_no: number;
    title: string;
    author: string;
    description: string;
    language: string;
    license_statement: string;
    publisher_name: string;
    publisher_slug: string;
    status: BookRevisionStatus;
    book_status: BookStatus;
    is_update: boolean;
    source_status: string;
    review_reason: string | null;
    updated_at: string;
    cover_key: string | null;
    document_id: string;
    version_id: string;
    file_name: string;
    page_count: number | null;
    live_revision_no: number | null;
    live_title: string | null;
    live_description: string | null;
    categories: { slug: string; name: string }[];
  }>(sql`
    select br.id, br.book_id, br.revision_no, br.title, br.author, br.description, br.language,
      br.license_statement, p.display_name as publisher_name, p.slug as publisher_slug, br.status,
      b.status as book_status,
      (b.published_revision_id is not null and b.published_revision_id <> br.id) as is_update,
      v.status::text as source_status, br.review_reason, br.updated_at, ca.file_key as cover_key,
      d.id as document_id, v.id as version_id, d.title as file_name, v.page_count,
      live.revision_no as live_revision_no, live.title as live_title,
      live.description as live_description,
      coalesce((select json_agg(json_build_object('slug', c.slug, 'name', c.name) order by c.name)
        from book_revision_categories brc join categories c on c.id = brc.category_id
        where brc.book_revision_id = br.id), '[]'::json) as categories
    from book_revisions br
    join books b on b.id = br.book_id
    join publisher_profiles p on p.id = b.publisher_id
    join document_versions v on v.id = br.document_version_id
    join documents d on d.id = v.document_id
    left join assets ca on ca.id = br.cover_asset_id and ca.state = 'ready'
    left join book_revisions live on live.id = b.published_revision_id and live.id <> br.id
    where br.id = ${revisionId} and br.status <> 'draft' and b.deleted_at is null`);
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    revisionNo: Number(row.revision_no),
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    licenseStatement: row.license_statement,
    publisherName: row.publisher_name,
    publisherSlug: row.publisher_slug,
    status: row.status,
    bookStatus: row.book_status,
    isUpdate: row.is_update,
    sourceStatus: row.source_status,
    reviewReason: row.review_reason,
    updatedAt: new Date(row.updated_at),
    coverKey: row.cover_key,
    categories: row.categories,
    source: {
      documentId: row.document_id,
      versionId: row.version_id,
      fileName: row.file_name,
      pageCount: row.page_count === null ? null : Number(row.page_count),
    },
    live:
      row.live_revision_no !== null
        ? {
            revisionNo: Number(row.live_revision_no),
            title: row.live_title ?? "",
            description: row.live_description ?? "",
          }
        : null,
  };
}

/**
 * The stored PDF of a submitted revision, for the moderator's review route.
 * Only public-bound sources (submitted or decided revisions) are reachable;
 * a draft or any private upload never is (Section 4).
 */
export async function submissionSourceFile(
  db: Executor,
  revisionId: string,
): Promise<{ fileKey: string; fileName: string } | null> {
  const [row] = await db.execute<{ file_key: string; title: string }>(sql`
    select a.file_key, d.title from book_revisions br
    join books b on b.id = br.book_id
    join document_versions v on v.id = br.document_version_id
    join documents d on d.id = v.document_id
    join assets a on a.id = v.asset_id
    where br.id = ${revisionId} and br.status in ('pending', 'approved', 'rejected')
      and b.deleted_at is null and a.file_route = 'bookSourcePdf' and a.state = 'ready'`);
  return row ? { fileKey: row.file_key, fileName: row.title } : null;
}

export type ModerationOutcome =
  | {
      ok: true;
      bookId: string;
      publisherSlug: string;
      /** Outbox keys to deliver after commit. */
      eventKeys: string[];
      /** Whether the public catalog changed (bump its version and tags). */
      catalogChanged: boolean;
    }
  | { ok: false; code: "not_found" | "already_decided" | "source_processing" };

/**
 * Approve or reject a pending revision. Approval, in one transaction: the
 * revision is approved and timestamped, the book points at it and is
 * published, the decision is audited, and the publisher's and followers'
 * notifications are queued. Rejection keeps the last approved revision live.
 */
export async function decideSubmission(
  db: Database,
  admin: Actor,
  input: { revisionId: string; action: "approve" | "reject"; reason?: string | undefined },
): Promise<ModerationOutcome> {
  return db.transaction(async (tx) => {
    const [target] = await tx.execute<{
      id: string;
      book_id: string;
      status: BookRevisionStatus;
      revision_no: number;
      version_status: string;
    }>(sql`
      select br.id, br.book_id, br.status, br.revision_no, v.status::text as version_status
      from book_revisions br
      join document_versions v on v.id = br.document_version_id
      where br.id = ${input.revisionId}
      for update of br`);
    if (!target) return { ok: false, code: "not_found" } as const;
    const [book] = await tx.execute<{
      id: string;
      status: BookStatus;
      publisher_id: string;
      slug: string;
      deleted_at: string | null;
    }>(sql`
      select b.id, b.status, b.publisher_id, p.slug, b.deleted_at from books b
      join publisher_profiles p on p.id = b.publisher_id
      where b.id = ${target.book_id}
      for update of b`);
    if (!book || book.deleted_at) return { ok: false, code: "not_found" } as const;
    if (target.status !== "pending" || book.status === "removed") {
      return { ok: false, code: "already_decided" } as const;
    }

    const approve = input.action === "approve";
    if (approve && target.version_status !== "ready") {
      return { ok: false, code: "source_processing" } as const;
    }
    await tx
      .update(bookRevisions)
      .set({
        status: approve ? "approved" : "rejected",
        reviewedBy: admin.id,
        reviewReason: input.reason ?? null,
        ...(approve ? { publishedAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(bookRevisions.id, target.id));
    if (approve) {
      await tx
        .update(books)
        .set({ status: "published", publishedRevisionId: target.id, updatedAt: sql`now()` })
        .where(eq(books.id, book.id));
    } else {
      await tx
        .update(books)
        .set({ status: book.status === "pending" ? "draft" : book.status, updatedAt: sql`now()` })
        .where(eq(books.id, book.id));
    }
    await writeAudit(tx, {
      actorId: admin.id,
      action: approve ? "book.approved" : "book.rejected",
      targetType: "book_revision",
      targetId: target.id,
      metadata: { bookId: book.id, revisionNo: Number(target.revision_no) },
    });

    const publisherUser = await publisherUserId(tx, book.publisher_id);
    const noticeKey = `submission-${input.action}:${target.id}`;
    await enqueue(tx, {
      key: noticeKey,
      name: EVENT_NAMES.notificationCreated,
      data: {
        userId: publisherUser,
        type: approve ? "submission_approved" : "submission_rejected",
        subjectId: target.id,
        operationKey: noticeKey,
      },
    });
    const eventKeys = [noticeKey];
    if (approve) {
      const fanOutKey = `book-published:${target.id}`;
      await enqueue(tx, {
        key: fanOutKey,
        name: EVENT_NAMES.catalogBookPublished,
        data: {
          bookId: book.id,
          revisionId: target.id,
          publisherId: book.publisher_id,
          operationKey: fanOutKey,
        },
      });
      eventKeys.push(fanOutKey);
    }
    return {
      ok: true,
      bookId: book.id,
      publisherSlug: book.slug,
      eventKeys,
      catalogChanged: approve,
    } as const;
  });
}

async function publisherUserId(db: Executor, publisherId: string): Promise<string> {
  const [row] = await db.execute<{ user_id: string }>(
    sql`select user_id from publisher_profiles where id = ${publisherId}`,
  );
  if (!row) throw new Error("Publisher profile is missing");
  return row.user_id;
}

/**
 * Take down a book (Section 5 row 16): it leaves the catalog and reading access
 * at once, a waiting submission is rejected with the same reason, and open
 * reports about it are resolved.
 */
export async function takedownBook(
  db: Database,
  admin: Actor,
  input: { bookId: string; reason: string; reportId?: string | undefined },
): Promise<ModerationOutcome> {
  return db.transaction(async (tx) => {
    const [book] = await tx.execute<{
      id: string;
      status: BookStatus;
      publisher_id: string;
      slug: string;
      published_revision_id: string | null;
      deleted_at: string | null;
    }>(sql`
      select b.id, b.status, b.publisher_id, p.slug, b.published_revision_id, b.deleted_at
      from books b join publisher_profiles p on p.id = b.publisher_id
      where b.id = ${input.bookId}
      for update of b`);
    if (!book || book.deleted_at) return { ok: false, code: "not_found" } as const;
    if (book.status === "removed") return { ok: false, code: "already_decided" } as const;

    await tx
      .update(books)
      .set({ status: "removed", updatedAt: sql`now()` })
      .where(eq(books.id, book.id));
    await tx
      .update(bookRevisions)
      .set({
        status: "rejected",
        reviewedBy: admin.id,
        reviewReason: input.reason,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(bookRevisions.bookId, book.id), inArray(bookRevisions.status, ["pending", "draft"])),
      );
    const resolved = await tx
      .update(contentReports)
      .set({
        status: "resolved",
        resolvedBy: admin.id,
        resolution: input.reason,
        updatedAt: sql`now()`,
      })
      .where(and(eq(contentReports.bookId, book.id), eq(contentReports.status, "open")))
      .returning({ id: contentReports.id });
    await writeAudit(tx, {
      actorId: admin.id,
      action: "book.taken_down",
      targetType: "book",
      targetId: book.id,
      metadata: {
        wasPublished: book.status === "published",
        reportsResolved: resolved.length,
        reportId: input.reportId ?? null,
      },
    });

    const subject =
      book.published_revision_id ??
      (
        await tx.execute<{ id: string }>(sql`
          select id from book_revisions where book_id = ${book.id}
          order by revision_no desc limit 1`)
      )[0]?.id;
    const eventKeys: string[] = [];
    if (subject) {
      const noticeKey = `book-takedown:${book.id}`;
      await enqueue(tx, {
        key: noticeKey,
        name: EVENT_NAMES.notificationCreated,
        data: {
          userId: await publisherUserId(tx, book.publisher_id),
          type: "book_taken_down",
          subjectId: subject,
          operationKey: noticeKey,
        },
      });
      eventKeys.push(noticeKey);
    }
    return {
      ok: true,
      bookId: book.id,
      publisherSlug: book.slug,
      eventKeys,
      catalogChanged: book.status === "published",
    } as const;
  });
}

/** Resolve or dismiss a report; the book itself is untouched (takedown is separate). */
export async function resolveReport(
  db: Database,
  admin: Actor,
  input: { reportId: string; action: "resolve" | "dismiss"; reason?: string | undefined },
): Promise<{ ok: true } | { ok: false; code: "not_found" | "already_decided" }> {
  return db.transaction(async (tx) => {
    const [report] = await tx
      .select({
        id: contentReports.id,
        status: contentReports.status,
        bookId: contentReports.bookId,
      })
      .from(contentReports)
      .where(eq(contentReports.id, input.reportId))
      .for("update");
    if (!report) return { ok: false, code: "not_found" } as const;
    if (report.status !== "open") return { ok: false, code: "already_decided" } as const;
    await tx
      .update(contentReports)
      .set({
        status: input.action === "resolve" ? "resolved" : "dismissed",
        resolvedBy: admin.id,
        resolution: input.reason ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(contentReports.id, report.id));
    await writeAudit(tx, {
      actorId: admin.id,
      action: input.action === "resolve" ? "report.resolved" : "report.dismissed",
      targetType: "content_report",
      targetId: report.id,
      metadata: { bookId: report.bookId },
    });
    return { ok: true } as const;
  });
}

export type ReportOutcome =
  | { ok: true; reportId: string }
  | { ok: false; code: "not_found" | "cannot_report" | "already_reported" };

/**
 * "Report a concern" (Section 28) on a published book. The reporter's details
 * are kept for moderators only; the audit entry records the reason code.
 */
export async function reportBook(
  db: Database,
  actor: Actor,
  input: { bookId: string; reason: ReportReason; details?: string | undefined },
): Promise<ReportOutcome> {
  if (actor.status !== "active") return { ok: false, code: "not_found" };
  try {
    return await db.transaction(async (tx) => {
      const [book] = await tx.execute<{ id: string; owner: string }>(sql`
        select b.id, p.user_id as owner from books b
        join publisher_profiles p on p.id = b.publisher_id
        where b.id = ${input.bookId} and b.status = 'published' and b.deleted_at is null`);
      if (!book) return { ok: false, code: "not_found" } as const;
      if (book.owner === actor.id) return { ok: false, code: "cannot_report" } as const;
      const [report] = await tx
        .insert(contentReports)
        .values({
          id: randomUUID(),
          reporterId: actor.id,
          bookId: book.id,
          reason: input.reason,
          details: input.details ?? null,
        })
        .returning({ id: contentReports.id });
      if (!report) throw new Error("Report was not saved");
      await writeAudit(tx, {
        actorId: actor.id,
        action: "report.created",
        targetType: "content_report",
        targetId: report.id,
        metadata: { bookId: book.id, reason: input.reason },
      });
      return { ok: true, reportId: report.id } as const;
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause ?? (error as { code?: string });
    if (cause?.code === "23505") return { ok: false, code: "already_reported" };
    throw error;
  }
}
