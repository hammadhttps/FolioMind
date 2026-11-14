import { languageName, type CatalogFacets, type CatalogResultIds } from "@foliomind/contracts";
import {
  CATALOG_PAGE_SIZE,
  type CatalogSearchParams,
  type PublisherBooksSearchParams,
} from "@foliomind/contracts/search-params";
import { catalogFacetsSchema, catalogResultIdsSchema } from "@foliomind/contracts";
import {
  analyticsDaily,
  libraryItems,
  publisherFollows,
  type Database,
  type Executor,
} from "@foliomind/db";
import type { Redis } from "@upstash/redis";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../access";
import { cached, CACHE_TTL_SECONDS, catalogVersion, type CacheKeys } from "../cache";
import { likePattern } from "../keyset";

/*
 * The public catalog (blueprint Sections 5 rows 1–4, 12, 23 and 24). Only
 * approved revisions of published, undeleted books by approved publishers
 * appear; drafts and pending revisions never do. Search uses the generated
 * `book_revisions.search_vector` with `websearch_to_tsquery('english')` ranked
 * by `ts_rank_cd`, and falls back to trigram word similarity on title, author
 * and publisher when full-text search finds nothing (a typo).
 */

/** Trigram fallback threshold (word_similarity), tuned on typos in tests. */
export const TRIGRAM_THRESHOLD = 0.4;
/** ts_rank_cd weights for D, C, B, A: description C, author B, title A (Postgres defaults). */
const RANK_WEIGHTS = "{0.1, 0.2, 0.4, 1.0}";

const PUBLIC_BOOKS = sql`
  from books b
  join book_revisions br on br.id = b.published_revision_id and br.book_id = b.id
  join publisher_profiles p on p.id = b.publisher_id`;
const PUBLIC_WHERE = sql`b.status = 'published' and b.deleted_at is null
  and br.status = 'approved' and p.status = 'approved'`;

interface SearchSpec {
  q?: string | undefined;
  /** Publisher Profile searches titles only (Section 24). */
  titleOnly?: boolean;
  categories: readonly string[];
  language?: string | undefined;
  publisherSlug?: string | undefined;
  sort: "newest" | "title" | "relevance";
  page: number;
  pageSize: number;
}

function baseFilters(spec: SearchSpec): SQL[] {
  const filters: SQL[] = [PUBLIC_WHERE];
  if (spec.categories.length > 0) {
    filters.push(sql`exists (
      select 1 from book_revision_categories brc join categories c on c.id = brc.category_id
      where brc.book_revision_id = br.id and c.slug in (${sql.join(
        spec.categories.map((slug) => sql`${slug}`),
        sql`, `,
      )}))`);
  }
  if (spec.language) filters.push(sql`br.language = ${spec.language}`);
  if (spec.publisherSlug) filters.push(sql`p.slug = ${spec.publisherSlug}`);
  return filters;
}

function orderFor(spec: SearchSpec, hasRank: boolean): SQL {
  if (spec.sort === "title") return sql`lower(br.title) asc, b.id asc`;
  if (spec.sort === "relevance" && hasRank) return sql`rank desc, br.published_at desc, b.id desc`;
  return sql`br.published_at desc, b.id desc`;
}

async function runSearch(
  db: Executor,
  spec: SearchSpec,
  mode: "plain" | "fulltext" | "trigram",
): Promise<CatalogResultIds> {
  const filters = baseFilters(spec);
  let rank: SQL = sql`0`;
  const q = spec.q ?? "";
  if (mode === "fulltext") {
    const query = sql`websearch_to_tsquery('english', ${q})`;
    if (spec.titleOnly) {
      filters.push(sql`to_tsvector('english', br.title) @@ ${query}`);
      rank = sql`ts_rank_cd(to_tsvector('english', br.title), ${query})`;
    } else {
      filters.push(
        sql`(br.search_vector @@ ${query} or to_tsvector('english', p.display_name) @@ ${query})`,
      );
      rank = sql`ts_rank_cd(${RANK_WEIGHTS}::float4[], br.search_vector, ${query})
        + case when to_tsvector('english', p.display_name) @@ ${query} then 0.1 else 0 end`;
    }
  } else if (mode === "trigram") {
    const similarity = spec.titleOnly
      ? sql`word_similarity(${q}, br.title)`
      : sql`greatest(word_similarity(${q}, br.title), word_similarity(${q}, br.author),
          word_similarity(${q}, p.display_name))`;
    filters.push(sql`${similarity} >= ${TRIGRAM_THRESHOLD}`);
    rank = similarity;
  }
  const where = sql.join(filters, sql` and `);
  const [count] = await db.execute<{ total: number }>(
    sql`select count(*)::int as total ${PUBLIC_BOOKS} where ${where}`,
  );
  const total = Number(count?.total ?? 0);
  if (total === 0) return { ids: [], total: 0 };
  const offset = (spec.page - 1) * spec.pageSize;
  if (offset >= total) return { ids: [], total };
  const rows = await db.execute<{ id: string }>(sql`
    select b.id, ${rank} as rank ${PUBLIC_BOOKS}
    where ${where}
    order by ${orderFor(spec, mode !== "plain")}
    limit ${spec.pageSize} offset ${offset}`);
  return { ids: rows.map((row) => row.id), total };
}

/** One page of matching book IDs and the total; full-text first, trigram on no hits. */
export async function searchCatalogIds(db: Executor, spec: SearchSpec): Promise<CatalogResultIds> {
  if (!spec.q) return runSearch(db, spec, "plain");
  const fullText = await runSearch(db, spec, "fulltext");
  if (fullText.total > 0) return fullText;
  return runSearch(db, spec, "trigram");
}

/** The stable form of Explore's params, hashed into the result cache key (Section 23). */
export function normalizeCatalogParams(params: CatalogSearchParams): string {
  return JSON.stringify({
    q: params.q?.toLowerCase().replace(/\s+/g, " ") ?? null,
    category: [...params.category].sort(),
    language: params.language ?? null,
    publisher: params.publisher ?? null,
    sort: params.sort,
    page: params.page,
  });
}

/** Explore's results, cached in Upstash per catalog version (10 minutes). */
export async function catalogPage(
  db: Executor,
  cache: { redis: Redis | null; keys: CacheKeys },
  params: CatalogSearchParams,
): Promise<CatalogResultIds> {
  const version = await catalogVersion(cache.redis, cache.keys);
  const result = await cached(cache.redis, {
    key: cache.keys.catalogResults(version, normalizeCatalogParams(params)),
    ttlSeconds: CACHE_TTL_SECONDS.catalogResults,
    schema: catalogResultIdsSchema,
    load: () =>
      searchCatalogIds(db, {
        q: params.q,
        categories: params.category,
        language: params.language,
        publisherSlug: params.publisher,
        sort: params.sort,
        page: params.page,
        pageSize: CATALOG_PAGE_SIZE,
      }),
  });
  return result ?? { ids: [], total: 0 };
}

/** A Publisher Profile's grid: title search, category, newest or title (Section 24). */
export async function publisherCatalogPage(
  db: Executor,
  publisherSlug: string,
  params: PublisherBooksSearchParams,
): Promise<CatalogResultIds> {
  return searchCatalogIds(db, {
    q: params.q,
    titleOnly: true,
    categories: params.category,
    publisherSlug,
    sort: params.sort,
    page: params.page,
    pageSize: CATALOG_PAGE_SIZE,
  });
}

export interface CatalogCardRecord {
  id: string;
  title: string;
  author: string;
  language: string;
  coverKey: string | null;
  categories: { slug: string; name: string }[];
  publisher: { slug: string; name: string };
  publishedAt: Date;
}

/** Cards for the given IDs, in the given order; anything no longer public is left out. */
export async function catalogCards(
  db: Executor,
  ids: readonly string[],
): Promise<CatalogCardRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{
    id: string;
    title: string;
    author: string;
    language: string;
    cover_key: string | null;
    categories: { slug: string; name: string }[];
    publisher_slug: string;
    publisher_name: string;
    published_at: string;
  }>(sql`
    select b.id, br.title, br.author, br.language, ca.file_key as cover_key,
      p.slug as publisher_slug, p.display_name as publisher_name, br.published_at,
      coalesce((select json_agg(json_build_object('slug', c.slug, 'name', c.name) order by c.name)
        from book_revision_categories brc join categories c on c.id = brc.category_id
        where brc.book_revision_id = br.id), '[]'::json) as categories
    ${PUBLIC_BOOKS}
    left join assets ca on ca.id = br.cover_asset_id and ca.state = 'ready'
    where ${PUBLIC_WHERE} and b.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        title: row.title,
        author: row.author,
        language: row.language,
        coverKey: row.cover_key,
        categories: row.categories,
        publisher: { slug: row.publisher_slug, name: row.publisher_name },
        publishedAt: new Date(row.published_at),
      },
    ];
  });
}

/** Category, language and publisher facets with counts, cached for an hour (Section 23). */
export async function catalogFacets(
  db: Executor,
  cache: { redis: Redis | null; keys: CacheKeys },
): Promise<CatalogFacets> {
  const version = await catalogVersion(cache.redis, cache.keys);
  const facets = await cached(cache.redis, {
    key: cache.keys.catalogFacets(version),
    ttlSeconds: CACHE_TTL_SECONDS.catalogFacets,
    schema: catalogFacetsSchema,
    load: () => loadFacets(db),
  });
  return facets ?? { categories: [], languages: [], publishers: [] };
}

export async function loadFacets(db: Executor): Promise<CatalogFacets> {
  const [categoryRows, languageRows, publisherRows] = await Promise.all([
    db.execute<{ slug: string; name: string; count: number }>(sql`
      select c.slug, c.name, count(*)::int as count ${PUBLIC_BOOKS}
      join book_revision_categories brc on brc.book_revision_id = br.id
      join categories c on c.id = brc.category_id
      where ${PUBLIC_WHERE}
      group by c.slug, c.name order by c.name`),
    db.execute<{ code: string; count: number }>(sql`
      select br.language as code, count(*)::int as count ${PUBLIC_BOOKS}
      where ${PUBLIC_WHERE} group by br.language order by count(*) desc, br.language`),
    db.execute<{ slug: string; name: string; count: number }>(sql`
      select p.slug, p.display_name as name, count(*)::int as count ${PUBLIC_BOOKS}
      where ${PUBLIC_WHERE} group by p.slug, p.display_name order by p.display_name`),
  ]);
  return {
    categories: categoryRows.map((row) => ({ ...row, count: Number(row.count) })),
    languages: languageRows.map((row) => ({
      code: row.code,
      name: languageName(row.code),
      count: Number(row.count),
    })),
    publishers: publisherRows.map((row) => ({ ...row, count: Number(row.count) })),
  };
}

/** Home's featured section: the newest approved books (Section 5 row 1). */
export async function featuredBooks(db: Executor, limit: number): Promise<CatalogCardRecord[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select b.id ${PUBLIC_BOOKS} where ${PUBLIC_WHERE}
    order by br.published_at desc, b.id desc limit ${limit}`);
  return catalogCards(
    db,
    rows.map((row) => row.id),
  );
}

export interface PublicBookRecord extends Omit<CatalogCardRecord, "publishedAt"> {
  revisionId: string;
  description: string;
  licenseStatement: string;
  pageCount: number | null;
  publishedAt: Date;
  documentId: string;
  versionId: string;
}

/** Book Details: the approved, published listing, or null (404) for anything else. */
export async function getPublicBook(
  db: Executor,
  bookId: string,
): Promise<PublicBookRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) return null;
  const [row] = await db.execute<{
    id: string;
    revision_id: string;
    title: string;
    author: string;
    description: string;
    language: string;
    license_statement: string;
    cover_key: string | null;
    page_count: number | null;
    published_at: string;
    document_id: string;
    version_id: string;
    publisher_slug: string;
    publisher_name: string;
    categories: { slug: string; name: string }[];
  }>(sql`
    select b.id, br.id as revision_id, br.title, br.author, br.description, br.language,
      br.license_statement, ca.file_key as cover_key, v.page_count, br.published_at,
      v.document_id, v.id as version_id, p.slug as publisher_slug, p.display_name as publisher_name,
      coalesce((select json_agg(json_build_object('slug', c.slug, 'name', c.name) order by c.name)
        from book_revision_categories brc join categories c on c.id = brc.category_id
        where brc.book_revision_id = br.id), '[]'::json) as categories
    ${PUBLIC_BOOKS}
    join document_versions v on v.id = br.document_version_id
    left join assets ca on ca.id = br.cover_asset_id and ca.state = 'ready'
    where ${PUBLIC_WHERE} and b.id = ${bookId}`);
  if (!row) return null;
  return {
    id: row.id,
    revisionId: row.revision_id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    licenseStatement: row.license_statement,
    coverKey: row.cover_key,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    publishedAt: new Date(row.published_at),
    documentId: row.document_id,
    versionId: row.version_id,
    categories: row.categories,
    publisher: { slug: row.publisher_slug, name: row.publisher_name },
  };
}

export interface PublicPublisherRecord {
  id: string;
  slug: string;
  name: string;
  bio: string;
  website: string | null;
  /** Only an avatar the account uploaded to FolioMind, never a provider picture. */
  avatarUrl: string | null;
  bookCount: number;
}

/** Publisher Profile: approved publishers only; no contact or private data. */
export async function getPublicPublisher(
  db: Executor,
  slug: string,
): Promise<PublicPublisherRecord | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [row] = await db.execute<{
    id: string;
    slug: string;
    display_name: string;
    bio: string;
    website: string | null;
    avatar_url: string | null;
    book_count: number;
  }>(sql`
    select p.id, p.slug, p.display_name, p.bio, p.website,
      case when u.avatar_asset_id is not null then u.avatar_url end as avatar_url,
      (select count(*)::int from books b
        join book_revisions br on br.id = b.published_revision_id
        where b.publisher_id = p.id and b.status = 'published' and b.deleted_at is null
          and br.status = 'approved') as book_count
    from publisher_profiles p join users u on u.id = p.user_id
    where p.slug = ${slug} and p.status = 'approved'`);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.display_name,
    bio: row.bio,
    website: row.website,
    avatarUrl: row.avatar_url,
    bookCount: Number(row.book_count),
  };
}

/** Public follower count, cached for five minutes (Section 23 "Public counters"). */
export async function followerCount(
  db: Executor,
  cache: { redis: Redis | null; keys: CacheKeys },
  publisherId: string,
): Promise<number> {
  const value = await cached(cache.redis, {
    key: cache.keys.publicCounter("followers", publisherId),
    ttlSeconds: CACHE_TTL_SECONDS.publicCounter,
    schema: z.number().int().min(0),
    load: async () => {
      const [row] = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from publisher_follows where publisher_id = ${publisherId}`,
      );
      return Number(row?.count ?? 0);
    },
  });
  return value ?? 0;
}

/* --- Signed-in reader state and actions ------------------------------------ */

export interface BookViewerRecord {
  saved: boolean;
  isOwner: boolean;
  report: { status: "open" | "resolved" | "dismissed"; createdAt: Date } | null;
}

export async function bookViewerState(
  db: Executor,
  userId: string,
  bookId: string,
): Promise<BookViewerRecord> {
  const [row] = await db.execute<{
    saved: boolean;
    is_owner: boolean;
    report_status: "open" | "resolved" | "dismissed" | null;
    report_created_at: string | null;
  }>(sql`
    select
      exists (select 1 from library_items where user_id = ${userId} and book_id = ${bookId}) as saved,
      exists (select 1 from books b join publisher_profiles p on p.id = b.publisher_id
        where b.id = ${bookId} and p.user_id = ${userId}) as is_owner,
      r.status as report_status, r.created_at as report_created_at
    from (select 1) one
    left join lateral (
      select status, created_at from content_reports
      where reporter_id = ${userId} and book_id = ${bookId}
      order by created_at desc limit 1
    ) r on true`);
  return {
    saved: row?.saved === true,
    isOwner: row?.is_owner === true,
    report:
      row?.report_status && row.report_created_at
        ? { status: row.report_status, createdAt: new Date(row.report_created_at) }
        : null,
  };
}

export interface AnalyticsDedupe {
  redis: Redis | null;
  keys: CacheKeys;
}

const ANALYTICS_DEDUPE_SECONDS = 2 * 24 * 60 * 60;
const utcDate = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Counts at most once per user, book and UTC day (Section 7 "basic counts"),
 * deduplicated with an Upstash `SET NX` key. Without Redis nothing is counted:
 * an undercount is safer than inflating a publisher's numbers.
 */
async function countOnce(
  db: Executor,
  dedupe: AnalyticsDedupe,
  input: { kind: "read" | "save"; bookId: string; userId: string; now: Date },
): Promise<boolean> {
  if (!dedupe.redis) return false;
  const date = utcDate(input.now);
  let first: unknown;
  try {
    first = await dedupe.redis.set(
      dedupe.keys.analyticsOnce(input.kind, input.bookId, input.userId, date),
      1,
      { nx: true, ex: ANALYTICS_DEDUPE_SECONDS },
    );
  } catch {
    return false;
  }
  if (first !== "OK") return false;
  await db
    .insert(analyticsDaily)
    .values({
      bookId: input.bookId,
      date,
      reads: input.kind === "read" ? 1 : 0,
      saves: input.kind === "save" ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [analyticsDaily.bookId, analyticsDaily.date],
      set:
        input.kind === "read"
          ? { reads: sql`${analyticsDaily.reads} + 1`, updatedAt: sql`now()` }
          : { saves: sql`${analyticsDaily.saves} + 1`, updatedAt: sql`now()` },
    });
  return true;
}

/** The published book whose live revision is this version, if a non-owner is reading one. */
export async function catalogBookForVersion(
  db: Executor,
  versionId: string,
): Promise<{ bookId: string; ownerId: string } | null> {
  const [row] = await db.execute<{ book_id: string; owner_id: string }>(sql`
    select b.id as book_id, p.user_id as owner_id ${PUBLIC_BOOKS}
    where ${PUBLIC_WHERE} and br.document_version_id = ${versionId}
    limit 1`);
  return row ? { bookId: row.book_id, ownerId: row.owner_id } : null;
}

/** Reading a catalog book records one daily read for that reader (not the publisher). */
export async function recordBookRead(
  db: Executor,
  dedupe: AnalyticsDedupe,
  input: { userId: string; versionId: string; now?: Date },
): Promise<boolean> {
  const book = await catalogBookForVersion(db, input.versionId);
  if (!book || book.ownerId === input.userId) return false;
  return countOnce(db, dedupe, {
    kind: "read",
    bookId: book.bookId,
    userId: input.userId,
    now: input.now ?? new Date(),
  });
}

export type SaveOutcome = { ok: true; saved: boolean } | { ok: false; code: "not_found" };

/**
 * Save to library (Section 11 "Saved book"): a personal `library_items` row,
 * never a change to the publisher's source. Removing it removes only the save.
 */
export async function setBookSaved(
  db: Database,
  dedupe: AnalyticsDedupe,
  actor: Actor,
  input: { bookId: string; saved: boolean; now?: Date },
): Promise<SaveOutcome> {
  if (actor.status !== "active") return { ok: false, code: "not_found" };
  if (!input.saved) {
    await db
      .delete(libraryItems)
      .where(and(eq(libraryItems.userId, actor.id), eq(libraryItems.bookId, input.bookId)));
    return { ok: true, saved: false };
  }
  const [book] = await db.execute<{ id: string; owner_id: string }>(sql`
    select b.id, p.user_id as owner_id ${PUBLIC_BOOKS}
    where ${PUBLIC_WHERE} and b.id = ${input.bookId}`);
  if (!book) return { ok: false, code: "not_found" };
  const inserted = await db
    .insert(libraryItems)
    .values({ userId: actor.id, bookId: book.id })
    .onConflictDoNothing()
    .returning({ id: libraryItems.id });
  if (inserted.length > 0 && book.owner_id !== actor.id) {
    await countOnce(db, dedupe, {
      kind: "save",
      bookId: book.id,
      userId: actor.id,
      now: input.now ?? new Date(),
    });
  }
  return { ok: true, saved: true };
}

export interface FollowRecord {
  following: boolean;
  notify: boolean;
  isOwner: boolean;
}

export async function followState(
  db: Executor,
  userId: string,
  publisherId: string,
): Promise<FollowRecord> {
  const [row] = await db.execute<{ notify: boolean | null; is_owner: boolean }>(sql`
    select
      (select notify from publisher_follows where user_id = ${userId} and publisher_id = ${publisherId}) as notify,
      exists (select 1 from publisher_profiles where id = ${publisherId} and user_id = ${userId}) as is_owner`);
  return {
    following: row?.notify !== null && row?.notify !== undefined,
    notify: row?.notify === true,
    isOwner: row?.is_owner === true,
  };
}

export type FollowOutcome =
  | { ok: true; following: boolean; notify: boolean }
  | { ok: false; code: "not_found" | "cannot_follow" };

/** Follow, unfollow or change the notify switch for an approved publisher (Section 11). */
export async function setFollow(
  db: Database,
  actor: Actor,
  input: { publisherId: string; following: boolean; notify?: boolean | undefined },
): Promise<FollowOutcome> {
  if (actor.status !== "active") return { ok: false, code: "not_found" };
  if (!input.following) {
    await db
      .delete(publisherFollows)
      .where(
        and(
          eq(publisherFollows.userId, actor.id),
          eq(publisherFollows.publisherId, input.publisherId),
        ),
      );
    return { ok: true, following: false, notify: false };
  }
  const [publisher] = await db.execute<{ id: string; user_id: string }>(sql`
    select id, user_id from publisher_profiles where id = ${input.publisherId} and status = 'approved'`);
  if (!publisher) return { ok: false, code: "not_found" };
  if (publisher.user_id === actor.id) return { ok: false, code: "cannot_follow" };
  const notify = input.notify ?? true;
  await db
    .insert(publisherFollows)
    .values({ userId: actor.id, publisherId: publisher.id, notify })
    .onConflictDoUpdate({
      target: [publisherFollows.userId, publisherFollows.publisherId],
      set: { notify: input.notify === undefined ? sql`${publisherFollows.notify}` : notify },
    });
  const state = await followState(db, actor.id, publisher.id);
  return { ok: true, following: state.following, notify: state.notify };
}

/* --- Publisher statistics -------------------------------------------------- */

export interface PublisherStats {
  days: number;
  reads: number;
  saves: number;
  followers: number;
  books: { id: string; title: string; reads: number; saves: number }[];
}

/**
 * Aggregate reads and saves from `analytics_daily` plus follower counts only
 * (Section 7): never who read, nor any question a reader asked.
 */
export async function publisherStats(
  db: Executor,
  publisherId: string,
  { days = 30, now = new Date() }: { days?: number; now?: Date } = {},
): Promise<PublisherStats> {
  const since = utcDate(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  const rows = await db.execute<{
    id: string;
    title: string | null;
    reads: number;
    saves: number;
  }>(sql`
    select b.id, t.title,
      coalesce(sum(a.reads), 0)::int as reads, coalesce(sum(a.saves), 0)::int as saves
    from books b
    left join lateral (
      select title from book_revisions where book_id = b.id
      order by (id = b.published_revision_id) desc, revision_no desc limit 1
    ) t on true
    left join analytics_daily a on a.book_id = b.id and a.date >= ${since}::date
    where b.publisher_id = ${publisherId} and b.deleted_at is null
      and b.published_revision_id is not null
    group by b.id, t.title
    order by reads desc, saves desc, t.title`);
  const [followers] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from publisher_follows where publisher_id = ${publisherId}`,
  );
  const books = rows.map((row) => ({
    id: row.id,
    title: row.title ?? "Untitled book",
    reads: Number(row.reads),
    saves: Number(row.saves),
  }));
  return {
    days,
    reads: books.reduce((sum, book) => sum + book.reads, 0),
    saves: books.reduce((sum, book) => sum + book.saves, 0),
    followers: Number(followers?.count ?? 0),
    books,
  };
}

/** Publishers whose title contains the term, for ⌘K. */
export async function searchPublishers(db: Executor, term: string, limit: number) {
  return db.execute<{ slug: string; display_name: string }>(sql`
    select slug, display_name from publisher_profiles
    where status = 'approved' and display_name ilike ${likePattern(term)}
    order by display_name limit ${limit}`);
}

/**
 * Followers who asked for notices, in keyset batches by user ID, for
 * notify-followers. Empty once the revision is no longer the live one, so a
 * late or repeated run tells nobody about a book that was since removed.
 */
export async function followersToNotify(
  db: Executor,
  input: { publisherId: string; revisionId: string; after?: string | null; limit: number },
): Promise<{ userIds: string[]; next: string | null }> {
  const rows = await db.execute<{ user_id: string }>(sql`
    select f.user_id from publisher_follows f
    join publisher_profiles p on p.id = f.publisher_id
    join users u on u.id = f.user_id
    where f.publisher_id = ${input.publisherId} and f.notify = true
      and f.user_id <> p.user_id and u.status = 'active' and u.deleted_at is null
      and exists (
        select 1 from books b where b.publisher_id = p.id and b.published_revision_id = ${input.revisionId}
          and b.status = 'published' and b.deleted_at is null)
      ${input.after ? sql`and f.user_id > ${input.after}::uuid` : sql``}
    order by f.user_id
    limit ${input.limit}`);
  const userIds = rows.map((row) => row.user_id);
  return { userIds, next: userIds.length === input.limit ? (userIds.at(-1) ?? null) : null };
}

/** Categories of one publisher's published books, for the profile's category filter. */
export async function publisherCategories(db: Executor, publisherSlug: string) {
  const rows = await db.execute<{ slug: string; name: string; count: number }>(sql`
    select c.slug, c.name, count(*)::int as count ${PUBLIC_BOOKS}
    join book_revision_categories brc on brc.book_revision_id = br.id
    join categories c on c.id = brc.category_id
    where ${PUBLIC_WHERE} and p.slug = ${publisherSlug}
    group by c.slug, c.name order by c.name`);
  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}

/** Which of these books the user has saved, for the cards' save controls. */
export async function savedBookIds(
  db: Executor,
  userId: string,
  bookIds: readonly string[],
): Promise<string[]> {
  if (bookIds.length === 0) return [];
  const rows = await db.execute<{ book_id: string }>(sql`
    select book_id from library_items
    where user_id = ${userId} and book_id in (${sql.join(
      bookIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  return rows.map((row) => row.book_id);
}
