import { z } from "zod";

/*
 * URL search-param contracts (blueprint Section 24). The web app binds the same
 * names with nuqs; Server Components parse them with these schemas. Unknown
 * params are ignored and invalid values fall back to defaults, so a malformed
 * URL never produces an error.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** Launch catalog taxonomy from the prototype (Section 20); Phase 4 seeds `categories` from it. */
export const CATALOG_CATEGORIES = [
  { slug: "environment", name: "Environment" },
  { slug: "design", name: "Design" },
  { slug: "research", name: "Research" },
] as const;

/** English first at launch (Section 1). */
export const CATALOG_LANGUAGES = [{ code: "en", name: "English" }] as const;

export const CATALOG_SORTS = ["newest", "title", "relevance"] as const;
export const CATALOG_PAGE_SIZE = 24;
export const CATALOG_MAX_PAGE = 100;

export const LIBRARY_TYPES = ["all", "uploads", "saved", "imported"] as const;
export const LIBRARY_SORTS = ["opened", "added", "title"] as const;

type RawParam = string | string[] | undefined;
const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const searchTerm = z
  .preprocess(first, z.string().trim().min(SEARCH_MIN_LENGTH).max(SEARCH_MAX_LENGTH).optional())
  .catch(undefined);

const slugList = z
  .preprocess(
    (value) =>
      String(first(value) ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)).max(10),
  )
  .catch([]);

/** Explore `/library`: q, category (comma list), language, sort, page. */
export const catalogSearchParamsSchema = z
  .object({
    q: searchTerm,
    category: slugList,
    language: z
      .preprocess(
        first,
        z
          .string()
          .regex(/^[a-z]{2}$/)
          .optional(),
      )
      .catch(undefined),
    sort: z.preprocess(first, z.enum(CATALOG_SORTS)).catch("newest"),
    page: z.preprocess(first, z.coerce.number().int().min(1).max(CATALOG_MAX_PAGE)).catch(1),
  })
  // Relevance only makes sense with a query (Section 24).
  .transform((params) => ({
    ...params,
    sort: params.sort === "relevance" && !params.q ? ("newest" as const) : params.sort,
  }));

export type CatalogSearchParams = z.infer<typeof catalogSearchParamsSchema>;

/** My Library: q, type, sort. Status and collection filters arrive with real documents. */
export const librarySearchParamsSchema = z.object({
  q: searchTerm,
  type: z.preprocess(first, z.enum(LIBRARY_TYPES)).catch("all"),
  sort: z.preprocess(first, z.enum(LIBRARY_SORTS)).catch("opened"),
});

export type LibrarySearchParams = z.infer<typeof librarySearchParamsSchema>;

export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  raw: Record<string, RawParam>,
): z.infer<T> {
  return schema.parse(raw);
}
