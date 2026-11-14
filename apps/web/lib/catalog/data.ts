import "server-only";
import {
  FEATURED_BOOK_COUNT,
  type CatalogBookCard,
  type CatalogFacets,
} from "@foliomind/contracts";
import type {
  CatalogSearchParams,
  PublisherBooksSearchParams,
} from "@foliomind/contracts/search-params";
import {
  catalogCards,
  catalogFacets,
  catalogPage,
  featuredBooks,
  followerCount,
  getPublicBook,
  getPublicPublisher,
  publisherCatalogPage,
  publisherCategories,
} from "@foliomind/domain";
import { cacheLife, cacheTag } from "next/cache";
import { getCacheKeys, getDb, getRequestRedis } from "@/lib/clients";
import { toCardView, toPublicBook } from "./view";

/*
 * Public catalog data (blueprint Section 23). Shared caches live in Upstash:
 * result IDs and totals per normalized params (10 minutes) and facets (1 hour),
 * both keyed by the catalog version that moderation bumps. Next.js caches the
 * rendered data under the `catalog`, `book:{id}` and `publisher:{slug}` tags,
 * which approve, unpublish and takedown expire with `updateTag`.
 */

export const catalogTags = {
  catalog: "catalog",
  book: (id: string) => `book:${id}`,
  publisher: (slug: string) => `publisher:${slug}`,
};

const cacheDeps = () => ({ redis: getRequestRedis(), keys: getCacheKeys() });

export interface ExploreData {
  total: number;
  books: CatalogBookCard[];
  facets: CatalogFacets;
}

export async function loadExplore(params: CatalogSearchParams): Promise<ExploreData> {
  "use cache";
  cacheTag(catalogTags.catalog);
  cacheLife("minutes");
  const db = getDb();
  const [result, facets] = await Promise.all([
    catalogPage(db, cacheDeps(), params),
    catalogFacets(db, cacheDeps()),
  ]);
  const cards = await catalogCards(db, result.ids);
  return { total: result.total, books: cards.map(toCardView), facets };
}

export async function loadFeaturedBooks(): Promise<CatalogBookCard[]> {
  "use cache";
  cacheTag(catalogTags.catalog);
  cacheLife("minutes");
  return (await featuredBooks(getDb(), FEATURED_BOOK_COUNT)).map(toCardView);
}

export async function loadPublicBook(bookId: string) {
  "use cache";
  cacheTag(catalogTags.catalog, catalogTags.book(bookId));
  cacheLife("minutes");
  const record = await getPublicBook(getDb(), bookId);
  return record ? toPublicBook(record) : null;
}

export async function loadPublicPublisher(slug: string) {
  "use cache";
  cacheTag(catalogTags.catalog, catalogTags.publisher(slug));
  cacheLife("minutes");
  const db = getDb();
  const publisher = await getPublicPublisher(db, slug);
  if (!publisher) return null;
  return { ...publisher, followers: await followerCount(db, cacheDeps(), publisher.id) };
}

export async function loadPublisherBooks(slug: string, params: PublisherBooksSearchParams) {
  "use cache";
  cacheTag(catalogTags.catalog, catalogTags.publisher(slug));
  cacheLife("minutes");
  const db = getDb();
  const [result, categories] = await Promise.all([
    publisherCatalogPage(db, slug, params),
    publisherCategories(db, slug),
  ]);
  const cards = await catalogCards(db, result.ids);
  return { total: result.total, books: cards.map(toCardView), categories };
}
