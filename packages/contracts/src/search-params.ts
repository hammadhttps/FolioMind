import { z } from "zod";

/*
 * URL search-param contracts (blueprint Section 24). The web app binds the same
 * names with nuqs; Server Components parse them with these schemas. Unknown
 * params are ignored and invalid values fall back to defaults, so a malformed
 * URL never produces an error.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** The prototype's Explore categories (Section 20); seeded first, before the general set. */
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

/** English first at launch (Section 1); Explore's language filter lists the languages in its facets. */
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

const slugParam = z
  .preprocess(
    first,
    z
      .string()
      .regex(/^[a-z0-9-]{1,60}$/)
      .optional(),
  )
  .catch(undefined);

/** Explore `/library`: q, category (comma list), language, publisher, sort, page. */
export const catalogSearchParamsSchema = z
  .object({
    q: searchTerm,
    category: slugList,
    publisher: slugParam,
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

export const PUBLISHER_BOOK_SORTS = ["newest", "title"] as const;

/** Publisher Profile's book grid (Section 24): title search, category, newest or title, pages of 24. */
export const publisherBooksSearchParamsSchema = z.object({
  q: searchTerm,
  category: slugList,
  sort: z.preprocess(first, z.enum(PUBLISHER_BOOK_SORTS)).catch("newest"),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(CATALOG_MAX_PAGE)).catch(1),
});
export type PublisherBooksSearchParams = z.infer<typeof publisherBooksSearchParamsSchema>;

export const PUBLISHING_STATUS_FILTERS = [
  "all",
  "draft",
  "pending",
  "published",
  "rejected",
  "unpublished",
] as const;

/** Publisher Dashboard (Section 24): title search, status, recently updated, keyset pages of 20. */
export const publishingSearchParamsSchema = z.object({
  q: searchTerm,
  status: z.preprocess(first, z.enum(PUBLISHING_STATUS_FILTERS)).catch("all"),
  tab: z.preprocess(first, z.enum(["books", "stats", "profile"])).catch("books"),
  /** The book editor opens in place of the list. */
  book: z.preprocess(first, z.uuid().optional()).catch(undefined),
  after: cursorParam,
  before: cursorParam,
  start: z.preprocess(first, z.coerce.number().int().min(1).max(100_000)).catch(1),
});
export type PublishingSearchParams = z.infer<typeof publishingSearchParamsSchema>;

const dateParam = z.preprocess(first, z.iso.date().optional()).catch(undefined);
const startParam = z.preprocess(first, z.coerce.number().int().min(1).max(100_000)).catch(1);

/** Content Moderation (Section 24): title or author, type, status, oldest first, pages of 25. */
export const MODERATION_TYPES = ["submission", "report"] as const;
export const MODERATION_STATUSES = ["open", "decided"] as const;
export const moderationSearchParamsSchema = z.object({
  q: searchTerm,
  type: z.preprocess(first, z.enum(MODERATION_TYPES)).catch("submission"),
  status: z.preprocess(first, z.enum(MODERATION_STATUSES)).catch("open"),
  /** The submission under review, shown beside the queue. */
  review: z.preprocess(first, z.uuid().optional()).catch(undefined),
  after: cursorParam,
  before: cursorParam,
  start: startParam,
});
export type ModerationSearchParams = z.infer<typeof moderationSearchParamsSchema>;

export const ADMIN_TAB_VALUES = ["health", "users", "applications", "usage", "audit"] as const;
export const ADMIN_USER_ROLES = ["all", "reader", "publisher", "admin"] as const;
export const ADMIN_USER_STATUSES = ["all", "active", "suspended", "deleting"] as const;
export const ADMIN_USER_PLANS = ["all", "free", "pro"] as const;
export const ADMIN_JOB_KINDS = [
  "all",
  "ingest-document",
  "import-url",
  "generate-outline",
  "generate-draft",
  "regenerate-section",
  "render-export",
] as const;
export const ADMIN_JOB_STATUSES = [
  "all",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const ADMIN_USAGE_RANGES = ["7", "30", "90"] as const;

/**
 * Admin Overview: one URL for every tab (Section 24). Switching tabs clears the
 * other tabs' filters; each list keeps its own keyset cursor in after/before.
 */
export const adminSearchParamsSchema = z.object({
  tab: z.preprocess(first, z.enum(ADMIN_TAB_VALUES)).catch("health"),
  q: searchTerm,
  role: z.preprocess(first, z.enum(ADMIN_USER_ROLES)).catch("all"),
  status: z.preprocess(first, z.string().max(20).optional()).catch(undefined),
  plan: z.preprocess(first, z.enum(ADMIN_USER_PLANS)).catch("all"),
  kind: z.preprocess(first, z.enum(ADMIN_JOB_KINDS)).catch("all"),
  action: z
    .preprocess(
      first,
      z
        .string()
        .regex(/^[a-z_.]{1,60}$/)
        .optional(),
    )
    .catch(undefined),
  from: dateParam,
  to: dateParam,
  range: z.preprocess(first, z.enum(ADMIN_USAGE_RANGES)).catch("30"),
  after: cursorParam,
  before: cursorParam,
  start: startParam,
});
export type AdminSearchParams = z.infer<typeof adminSearchParamsSchema>;

export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  raw: Record<string, RawParam>,
): z.infer<T> {
  return schema.parse(raw);
}
