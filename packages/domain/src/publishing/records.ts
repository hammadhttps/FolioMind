import {
  BOOK_FILE_ROUTES,
  type BookRevisionStatus,
  type BookStatus,
  type PublisherStatus,
} from "@foliomind/contracts";
import { books, publisherProfiles, users, type Executor } from "@foliomind/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "../access";

/*
 * Shared reads for publishing (blueprint Sections 4, 6 and 12). The publisher
 * role is granted only by an admin approving an application; every publisher
 * action re-reads the role, the profile and the book's owner from Postgres, so
 * a cached snapshot can never let a demoted or suspended account act.
 */

export interface PublisherProfileRecord {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  bio: string;
  website: string | null;
  status: PublisherStatus;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const profileColumns = {
  id: publisherProfiles.id,
  userId: publisherProfiles.userId,
  slug: publisherProfiles.slug,
  displayName: publisherProfiles.displayName,
  bio: publisherProfiles.bio,
  website: publisherProfiles.website,
  status: publisherProfiles.status,
  reviewReason: publisherProfiles.reviewReason,
  createdAt: publisherProfiles.createdAt,
  updatedAt: publisherProfiles.updatedAt,
};

export async function getPublisherProfileForUser(
  db: Executor,
  userId: string,
): Promise<PublisherProfileRecord | null> {
  const [row] = await db
    .select(profileColumns)
    .from(publisherProfiles)
    .where(eq(publisherProfiles.userId, userId));
  return row ?? null;
}

/**
 * The actor's approved publisher profile, or null. Requires an active account
 * whose stored role is `publisher` (Section 4: admin does not imply publisher).
 */
export async function approvedPublisherFor(
  db: Executor,
  actor: Actor,
  options: { lock?: boolean } = {},
): Promise<PublisherProfileRecord | null> {
  if (actor.status !== "active") return null;
  const query = db
    .select(profileColumns)
    .from(publisherProfiles)
    .innerJoin(users, eq(users.id, publisherProfiles.userId))
    .where(
      and(
        eq(publisherProfiles.userId, actor.id),
        eq(publisherProfiles.status, "approved"),
        eq(users.role, "publisher"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
  const [row] = options.lock ? await query.for("update", { of: publisherProfiles }) : await query;
  return row ?? null;
}

export interface OwnedBookRecord {
  id: string;
  publisherId: string;
  status: BookStatus;
  publishedRevisionId: string | null;
}

/** A book of this publisher that hasn't been deleted; locked when asked. */
export async function getOwnedBook(
  db: Executor,
  publisherId: string,
  bookId: string,
  options: { lock?: boolean } = {},
): Promise<OwnedBookRecord | null> {
  const query = db
    .select({
      id: books.id,
      publisherId: books.publisherId,
      status: books.status,
      publishedRevisionId: books.publishedRevisionId,
    })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.publisherId, publisherId), isNull(books.deletedAt)));
  const [row] = options.lock ? await query.for("update") : await query;
  return row ?? null;
}

export interface RevisionRecord {
  id: string;
  bookId: string;
  revisionNo: number;
  status: BookRevisionStatus;
  documentVersionId: string;
  title: string;
  author: string;
  description: string;
  language: string;
  licenseStatement: string;
  coverAssetId: string | null;
  reviewReason: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The revision being edited or reviewed, if any (at most one, by a unique index). */
export async function openRevision(
  db: Executor,
  bookId: string,
  options: { lock?: boolean } = {},
): Promise<RevisionRecord | null> {
  const rows = await db.execute<{
    id: string;
    book_id: string;
    revision_no: number;
    status: BookRevisionStatus;
    document_version_id: string;
    title: string;
    author: string;
    description: string;
    language: string;
    license_statement: string;
    cover_asset_id: string | null;
    review_reason: string | null;
    published_at: string | null;
    created_at: string;
    updated_at: string;
  }>(sql`
    select * from book_revisions
    where book_id = ${bookId} and status in ('draft', 'pending')
    ${options.lock ? sql`for update` : sql``}`);
  const row = rows[0];
  return row ? toRevisionRecord(row) : null;
}

/** The newest revision of a book, whatever its status. */
export async function latestRevision(db: Executor, bookId: string): Promise<RevisionRecord | null> {
  const rows = await db.execute<Parameters<typeof toRevisionRecord>[0]>(sql`
    select * from book_revisions where book_id = ${bookId}
    order by revision_no desc limit 1`);
  const row = rows[0];
  return row ? toRevisionRecord(row) : null;
}

export function toRevisionRecord(row: {
  id: string;
  book_id: string;
  revision_no: number;
  status: BookRevisionStatus;
  document_version_id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  license_statement: string;
  cover_asset_id: string | null;
  review_reason: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}): RevisionRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    revisionNo: Number(row.revision_no),
    status: row.status,
    documentVersionId: row.document_version_id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    licenseStatement: row.license_statement,
    coverAssetId: row.cover_asset_id,
    reviewReason: row.review_reason,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/* --- The publishing allowance (user decision, 2026-11-09) ------------------ */

const bookRoutes = sql.join(
  BOOK_FILE_ROUTES.map((route) => sql`${route}`),
  sql`, `,
);

/** Bytes of book sources and covers the publisher's account holds (a gauge). */
export async function bookFileBytesUsed(db: Executor, userId: string): Promise<number> {
  const [row] = await db.execute<{ bytes: string | number }>(sql`
    select coalesce(sum(bytes), 0)::bigint as bytes from assets
    where owner_id = ${userId} and file_route in (${bookRoutes})
      and state in ('pending', 'ready')`);
  return Number(row?.bytes ?? 0);
}

/** Books that count toward the limit: not deleted and not removed by moderation. */
export async function activeBookCount(db: Executor, publisherId: string): Promise<number> {
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from books
    where publisher_id = ${publisherId} and deleted_at is null and status <> 'removed'`);
  return Number(row?.count ?? 0);
}

/** Book files stored in the last 24 hours. */
export async function recentBookUploads(db: Executor, userId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [row] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from assets
    where owner_id = ${userId} and file_route in (${bookRoutes})
      and created_at >= ${since}::timestamptz`);
  return Number(row?.count ?? 0);
}

/**
 * A document holds a book source when one of its versions came through the
 * `bookSourcePdf` route. Such documents belong to the publishing allowance and
 * never appear in the owner's personal library or plan gauges.
 */
export const isBookSourceDocument = (documentIdColumn: unknown) => sql`exists (
  select 1 from document_versions bsv
  join assets bsa on bsa.id = bsv.asset_id
  where bsv.document_id = ${documentIdColumn} and bsa.file_route = 'bookSourcePdf')`;

/** True once any revision of this publisher's books has been approved: the slug then locks. */
export async function hasPublishedBook(db: Executor, publisherId: string): Promise<boolean> {
  const [row] = await db.execute<{ published: boolean }>(sql`
    select exists (
      select 1 from book_revisions br
      join books b on b.id = br.book_id
      where b.publisher_id = ${publisherId} and br.status = 'approved'
    ) as published`);
  return row?.published === true;
}

/** Soft-revoke the given source documents and covers no other revision still uses. */
export async function releaseUnusedBookFiles(
  db: Executor,
  input: { documentIds: readonly string[]; coverAssetIds: readonly string[] },
): Promise<string[]> {
  const fileKeys: string[] = [];
  for (const documentId of new Set(input.documentIds)) {
    const [used] = await db.execute<{ used: boolean }>(sql`
      select exists (
        select 1 from book_revisions br
        join document_versions dv on dv.id = br.document_version_id
        join books b on b.id = br.book_id
        where dv.document_id = ${documentId} and b.deleted_at is null
      ) as used`);
    if (used?.used) continue;
    await db.execute(sql`
      update documents set status = 'deleting', deleted_at = now(), updated_at = now()
      where id = ${documentId} and status = 'active'`);
    const revoked = await db.execute<{ file_key: string }>(sql`
      update assets set state = 'deleting', updated_at = now()
      where id in (select asset_id from document_versions where document_id = ${documentId})
        and state in ('pending', 'ready')
      returning file_key`);
    fileKeys.push(...revoked.map((row) => row.file_key));
  }
  for (const assetId of new Set(input.coverAssetIds)) {
    const revoked = await db.execute<{ file_key: string }>(sql`
      update assets set state = 'deleting', updated_at = now()
      where id = ${assetId} and state in ('pending', 'ready')
        and not exists (
          select 1 from book_revisions br join books b on b.id = br.book_id
          where br.cover_asset_id = ${assetId} and b.deleted_at is null)
      returning file_key`);
    fileKeys.push(...revoked.map((row) => row.file_key));
  }
  return fileKeys;
}
