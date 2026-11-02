import { ATTENTION_VERSION_STATUSES, PROCESSING_VERSION_STATUSES } from "@foliomind/contracts";
import type {
  LIBRARY_SORTS,
  LIBRARY_STATUSES,
  LIBRARY_TYPES,
} from "@foliomind/contracts/search-params";
import type { Executor } from "@foliomind/db";
import { sql, type SQL } from "drizzle-orm";

/*
 * My Library (blueprint Sections 5, 11 and 24): the user's saved items, which
 * are their uploads and imports now and saved catalog books from Phase 9, with
 * search, filters, sorts and keyset pagination ("Load more"). Authorization
 * comes first: only the user's own items, only active documents and published
 * books.
 */

export type LibraryKind = "upload" | "imported" | "saved";
export type LibraryStatus = "ready" | "processing" | "attention";

export interface LibraryEntry {
  id: string;
  documentId: string | null;
  bookId: string | null;
  title: string;
  author: string | null;
  kind: LibraryKind;
  status: LibraryStatus;
  addedAt: Date;
  lastOpenedAt: Date | null;
  collectionIds: string[];
}

export interface LibraryQuery {
  userId: string;
  q?: string | undefined;
  type: (typeof LIBRARY_TYPES)[number];
  status: (typeof LIBRARY_STATUSES)[number];
  collectionId?: string | undefined;
  sort: (typeof LIBRARY_SORTS)[number];
  cursor?: string | undefined;
  limit: number;
}

interface Cursor {
  v: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Malformed or tampered cursors read as "first page", never as an error. */
export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Cursor).v === "string" &&
      typeof (parsed as Cursor).id === "string" &&
      /^[0-9a-f-]{36}$/i.test((parsed as Cursor).id)
    ) {
      return parsed as Cursor;
    }
  } catch {
    // Fall through.
  }
  return null;
}

function statusOf(versionStatus: string | null, kind: LibraryKind): LibraryStatus {
  if (kind === "saved" || versionStatus === "ready") return "ready";
  if ((ATTENTION_VERSION_STATUSES as readonly string[]).includes(versionStatus ?? "")) {
    return "attention";
  }
  return "processing";
}

const inList = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

const toDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);

export async function listLibrary(
  db: Executor,
  query: LibraryQuery,
): Promise<{ items: LibraryEntry[]; nextCursor: string | null }> {
  const filters: SQL[] = [];
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    filters.push(sql`title ilike ${pattern}`);
  }
  if (query.type === "uploads") filters.push(sql`kind = 'upload'`);
  if (query.type === "imported") filters.push(sql`kind = 'imported'`);
  if (query.type === "saved") filters.push(sql`kind = 'saved'`);
  if (query.status === "ready") filters.push(sql`(kind = 'saved' or version_status = 'ready')`);
  if (query.status === "processing") {
    filters.push(sql`version_status in (${inList(PROCESSING_VERSION_STATUSES)})`);
  }
  if (query.status === "attention") {
    filters.push(sql`version_status in (${inList(ATTENTION_VERSION_STATUSES)})`);
  }
  if (query.collectionId) {
    filters.push(sql`exists (
      select 1 from collection_items ci
      join collections c on c.id = ci.collection_id
      where ci.library_item_id = entries.id
        and c.id = ${query.collectionId}
        and c.user_id = ${query.userId})`);
  }

  const sortKey =
    query.sort === "title"
      ? sql`lower(title)`
      : query.sort === "added"
        ? sql`added_at`
        : sql`coalesce(last_opened_at, added_at)`;
  const ascending = query.sort === "title";
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    const value = ascending ? sql`${cursor.v}` : sql`${cursor.v}::timestamptz`;
    filters.push(
      ascending
        ? sql`(${sortKey}, id) > (${value}, ${cursor.id}::uuid)`
        : sql`(${sortKey}, id) < (${value}, ${cursor.id}::uuid)`,
    );
  }
  const where = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
  const order = ascending ? sql`asc` : sql`desc`;

  const rows = await db.execute<{
    id: string;
    document_id: string | null;
    book_id: string | null;
    title: string;
    author: string | null;
    kind: LibraryKind;
    version_status: string | null;
    added_at: string;
    last_opened_at: string | null;
    collection_ids: string[];
    sort_value: string;
  }>(sql`
    with entries as (
      select
        li.id,
        li.document_id,
        li.book_id,
        li.created_at as added_at,
        coalesce(d.title, br.title) as title,
        br.author,
        case
          when li.book_id is not null then 'saved'
          when d.source_kind = 'url_import' then 'imported'
          else 'upload'
        end as kind,
        v.status::text as version_status,
        (
          select max(rp.last_read_at)
          from reading_progress rp
          join document_versions dv on dv.id = rp.document_version_id
          where rp.user_id = li.user_id and dv.document_id = coalesce(d.id, bv.document_id)
        ) as last_opened_at,
        coalesce(
          (select json_agg(ci.collection_id) from collection_items ci where ci.library_item_id = li.id),
          '[]'::json
        ) as collection_ids
      from library_items li
      left join documents d on d.id = li.document_id
      left join document_versions v on v.id = d.current_version_id
      left join books b on b.id = li.book_id
      left join book_revisions br on br.id = b.published_revision_id
      left join document_versions bv on bv.id = br.document_version_id
      where li.user_id = ${query.userId}
        and (li.document_id is null or (d.status = 'active' and d.deleted_at is null))
        and (li.book_id is null or (b.status = 'published' and b.deleted_at is null))
    )
    select *, (${sortKey})::text as sort_value
    from entries
    ${where}
    order by ${sortKey} ${order}, id ${order}
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const hasMore = rows.length > query.limit;
  return {
    items: page.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      bookId: row.book_id,
      title: row.title,
      author: row.author,
      kind: row.kind,
      status: statusOf(row.version_status, row.kind),
      addedAt: new Date(row.added_at),
      lastOpenedAt: toDate(row.last_opened_at),
      collectionIds: row.collection_ids,
    })),
    nextCursor: hasMore && last ? encodeCursor({ v: last.sort_value, id: last.id }) : null,
  };
}

export interface DashboardCounts {
  documents: number;
  savedBooks: number;
  workspaces: number;
  projects: number;
}

/** Real figures for the Dashboard metric cards (Section 20 #6). */
export async function dashboardCounts(db: Executor, userId: string): Promise<DashboardCounts> {
  const [row] = await db.execute<{
    documents: number;
    saved_books: number;
    workspaces: number;
    projects: number;
  }>(sql`
    select
      (select count(*)::int from documents
        where owner_id = ${userId} and status = 'active' and deleted_at is null) as documents,
      (select count(*)::int from library_items where user_id = ${userId} and book_id is not null) as saved_books,
      (select count(*)::int from workspaces where owner_id = ${userId}) as workspaces,
      (select count(*)::int from projects where owner_id = ${userId} and archived_at is null) as projects`);
  return {
    documents: Number(row?.documents ?? 0),
    savedBooks: Number(row?.saved_books ?? 0),
    workspaces: Number(row?.workspaces ?? 0),
    projects: Number(row?.projects ?? 0),
  };
}

export interface ContinueReadingEntry {
  documentId: string;
  title: string;
  pageNumber: number;
  pageCount: number | null;
  lastReadAt: Date;
}

/** "Pick up where you left off": the most recently read documents the user can still open. */
export async function continueReading(
  db: Executor,
  userId: string,
  limit = 3,
): Promise<ContinueReadingEntry[]> {
  const rows = await db.execute<{
    document_id: string;
    title: string;
    page_number: number;
    page_count: number | null;
    position_page_count: number | null;
    last_read_at: string;
  }>(sql`
    select d.id as document_id, d.title, rp.page_number, v.page_count,
      (rp.position->>'pageCount')::int as position_page_count, rp.last_read_at
    from reading_progress rp
    join document_versions v on v.id = rp.document_version_id
    join documents d on d.id = v.document_id and d.current_version_id = v.id
    where rp.user_id = ${userId}
      and d.status = 'active' and d.deleted_at is null
      and (
        d.owner_id = ${userId}
        or exists (
          select 1 from book_revisions br
          join books b on b.published_revision_id = br.id
          where br.document_version_id = v.id
            and br.status = 'approved' and b.status = 'published' and b.deleted_at is null
        )
      )
    order by rp.last_read_at desc
    limit ${limit}`);
  return rows.map((row) => ({
    documentId: row.document_id,
    title: row.title,
    pageNumber: Number(row.page_number),
    pageCount: row.page_count ?? row.position_page_count ?? null,
    lastReadAt: new Date(row.last_read_at),
  }));
}
