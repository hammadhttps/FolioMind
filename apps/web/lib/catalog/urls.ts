import {
  CATALOG_MAX_PAGE,
  CATALOG_PAGE_SIZE,
  type CatalogSearchParams,
  type PublisherBooksSearchParams,
} from "@foliomind/contracts/search-params";

/* Canonical catalog URLs (Section 24): default params are left out. */

export function exploreHref(
  params: CatalogSearchParams,
  overrides: Partial<CatalogSearchParams> = {},
): string {
  const next = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.category.length > 0) query.set("category", next.category.join(","));
  if (next.language) query.set("language", next.language);
  if (next.publisher) query.set("publisher", next.publisher);
  if (next.sort !== "newest") query.set("sort", next.sort);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `/library?${text}` : "/library";
}

export function publisherHref(
  slug: string,
  params: PublisherBooksSearchParams,
  overrides: Partial<PublisherBooksSearchParams> = {},
): string {
  const next = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.category.length > 0) query.set("category", next.category.join(","));
  if (next.sort !== "newest") query.set("sort", next.sort);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `/publishers/${slug}?${text}` : `/publishers/${slug}`;
}

/** Pages to show, capped at the Section 24 maximum (deeper pages ask to refine the search). */
export function totalPages(total: number): number {
  return Math.min(CATALOG_MAX_PAGE, Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)));
}

/** First, last, the current page and its neighbours, with gaps marked as null. */
export function pageWindow(current: number, last: number): (number | null)[] {
  const pages = new Set([1, last, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (const page of sorted) {
    const previous = result.at(-1);
    if (typeof previous === "number" && page - previous > 1) result.push(null);
    result.push(page);
  }
  return result;
}
