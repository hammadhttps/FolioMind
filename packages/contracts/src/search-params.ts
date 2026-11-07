import { z } from "zod";

/*
 * URL search-param contracts (blueprint Section 24). The web app binds the same
 * names with nuqs; Server Components parse them with these schemas. Unknown
 * params are ignored and invalid values fall back to defaults, so a malformed
 * URL never produces an error.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** The prototype's Explore pills (Section 20) until Phase 9 builds them from category facets. */
export const CATALOG_CATEGORIES = [
  { slug: "environment", name: "Environment" },
  { slug: "design", name: "Design" },
  { slug: "research", name: "Research" },
] as const;

/** Rows the required seed creates in `categories`: the prototype's three plus a general set. */
export const STARTER_CATEGORIES = [
  ...CATALOG_CATEGORIES,
  { slug: "science", name: "Science" },
  { slug: "technology", name: "Technology" },
  { slug: "history", name: "History" },
  { slug: "business", name: "Business" },
  { slug: "education", name: "Education" },
  { slug: "health", name: "Health" },
  { slug: "arts", name: "Arts" },
  { slug: "philosophy", name: "Philosophy" },
] as const;

/** English first at launch (Section 1). */
export const CATALOG_LANGUAGES = [{ code: "en", name: "English" }] as const;

export const CATALOG_SORTS = ["newest", "title", "relevance"] as const;
export const CATALOG_PAGE_SIZE = 24;
export const CATALOG_MAX_PAGE = 100;

export const LIBRARY_TYPES = ["all", "uploads", "saved", "imported"] as const;
export const LIBRARY_STATUSES = ["all", "ready", "processing", "attention"] as const;
export const LIBRARY_SORTS = ["opened", "added", "title"] as const;
export const LIBRARY_PAGE_SIZE = 24;

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

/**
 * My Library (Section 24): q, type, status, collection and sort. "Load more"
 * appends keyset pages in the client, so the cursor is not part of the URL.
 */
export const librarySearchParamsSchema = z.object({
  q: searchTerm,
  type: z.preprocess(first, z.enum(LIBRARY_TYPES)).catch("all"),
  status: z.preprocess(first, z.enum(LIBRARY_STATUSES)).catch("all"),
  collection: z.preprocess(first, z.uuid().optional()).catch(undefined),
  sort: z.preprocess(first, z.enum(LIBRARY_SORTS)).catch("opened"),
});

export type LibrarySearchParams = z.infer<typeof librarySearchParamsSchema>;

export const WORKSPACE_SORTS = ["updated", "name"] as const;

/** Dashboard research tab (Section 24): search by name, recently updated or by name. */
export const workspaceSearchParamsSchema = z.object({
  q: searchTerm,
  sort: z.preprocess(first, z.enum(WORKSPACE_SORTS)).catch("updated"),
});

export type WorkspaceSearchParams = z.infer<typeof workspaceSearchParamsSchema>;

export const PROJECT_SORTS = ["updated", "created", "title"] as const;
export const PROJECT_LIST_STATUSES = [
  "all",
  "draft",
  "generating",
  "editing",
  "rendering",
  "complete",
  "failed",
] as const;
export const PROJECT_LIST_MODES = ["all", "research", "general"] as const;
export const PROJECT_LIST_TEMPLATES = ["all", "academic-report", "study-notes"] as const;
export const PROJECT_LIST_ARCHIVED = ["active", "archived"] as const;

const cursorParam = z.preprocess(first, z.string().max(500).optional()).catch(undefined);

/**
 * My Projects (Section 24): search, status, mode, template, archived, sort, with
 * `after`/`before` keyset cursors. `start` only numbers the "Showing 21–40" line.
 */
export const projectsSearchParamsSchema = z.object({
  q: searchTerm,
  status: z.preprocess(first, z.enum(PROJECT_LIST_STATUSES)).catch("all"),
  mode: z.preprocess(first, z.enum(PROJECT_LIST_MODES)).catch("all"),
  template: z.preprocess(first, z.enum(PROJECT_LIST_TEMPLATES)).catch("all"),
  archived: z.preprocess(first, z.enum(PROJECT_LIST_ARCHIVED)).catch("active"),
  sort: z.preprocess(first, z.enum(PROJECT_SORTS)).catch("updated"),
  after: cursorParam,
  before: cursorParam,
  start: z.preprocess(first, z.coerce.number().int().min(1).max(100_000)).catch(1),
});

export type ProjectsSearchParams = z.infer<typeof projectsSearchParamsSchema>;

export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  raw: Record<string, RawParam>,
): z.infer<T> {
  return schema.parse(raw);
}
