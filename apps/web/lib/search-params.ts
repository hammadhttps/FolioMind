import {
  ADMIN_JOB_KINDS,
  ADMIN_TAB_VALUES,
  ADMIN_USAGE_RANGES,
  ADMIN_USER_PLANS,
  ADMIN_USER_ROLES,
  CATALOG_SORTS,
  MODERATION_STATUSES,
  MODERATION_TYPES,
  PUBLISHER_BOOK_SORTS,
  PUBLISHING_STATUS_FILTERS,
  LIBRARY_SORTS,
  LIBRARY_STATUSES,
  LIBRARY_TYPES,
  PROJECT_LIST_ARCHIVED,
  PROJECT_LIST_MODES,
  PROJECT_LIST_STATUSES,
  PROJECT_LIST_TEMPLATES,
  PROJECT_SORTS,
  WORKSPACE_SORTS,
} from "@foliomind/contracts/search-params";
import { parseAsArrayOf, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs";

/*
 * nuqs bindings for the Section 24 URL contracts in @foliomind/contracts. The
 * names and defaults mirror the Zod schemas the server parses.
 */
export const catalogParsers = {
  q: parseAsString.withDefault(""),
  category: parseAsArrayOf(parseAsString).withDefault([]),
  language: parseAsString,
  publisher: parseAsString,
  sort: parseAsStringLiteral(CATALOG_SORTS).withDefault("newest"),
  page: parseAsInteger.withDefault(1),
};

export const libraryParsers = {
  q: parseAsString.withDefault(""),
  type: parseAsStringLiteral(LIBRARY_TYPES).withDefault("all"),
  status: parseAsStringLiteral(LIBRARY_STATUSES).withDefault("all"),
  collection: parseAsString,
  sort: parseAsStringLiteral(LIBRARY_SORTS).withDefault("opened"),
};

export const workspaceParsers = {
  q: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(WORKSPACE_SORTS).withDefault("updated"),
};

export const projectsParsers = {
  q: parseAsString.withDefault(""),
  status: parseAsStringLiteral(PROJECT_LIST_STATUSES).withDefault("all"),
  mode: parseAsStringLiteral(PROJECT_LIST_MODES).withDefault("all"),
  template: parseAsStringLiteral(PROJECT_LIST_TEMPLATES).withDefault("all"),
  archived: parseAsStringLiteral(PROJECT_LIST_ARCHIVED).withDefault("active"),
  sort: parseAsStringLiteral(PROJECT_SORTS).withDefault("updated"),
  after: parseAsString,
  before: parseAsString,
  start: parseAsInteger.withDefault(1),
};

export const DASHBOARD_TABS = ["overview", "research"] as const;
export const dashboardTabParser = parseAsStringLiteral(DASHBOARD_TABS).withDefault("overview");

export const publisherBooksParsers = {
  q: parseAsString.withDefault(""),
  category: parseAsArrayOf(parseAsString).withDefault([]),
  sort: parseAsStringLiteral(PUBLISHER_BOOK_SORTS).withDefault("newest"),
  page: parseAsInteger.withDefault(1),
};

export const publishingParsers = {
  q: parseAsString.withDefault(""),
  status: parseAsStringLiteral(PUBLISHING_STATUS_FILTERS).withDefault("all"),
  tab: parseAsStringLiteral(["books", "stats", "profile"] as const).withDefault("books"),
  book: parseAsString,
  after: parseAsString,
  before: parseAsString,
  start: parseAsInteger.withDefault(1),
};

export const moderationParsers = {
  q: parseAsString.withDefault(""),
  type: parseAsStringLiteral(MODERATION_TYPES).withDefault("submission"),
  status: parseAsStringLiteral(MODERATION_STATUSES).withDefault("open"),
  review: parseAsString,
  after: parseAsString,
  before: parseAsString,
  start: parseAsInteger.withDefault(1),
};

export const adminParsers = {
  tab: parseAsStringLiteral(ADMIN_TAB_VALUES).withDefault("health"),
  q: parseAsString.withDefault(""),
  role: parseAsStringLiteral(ADMIN_USER_ROLES).withDefault("all"),
  status: parseAsString,
  plan: parseAsStringLiteral(ADMIN_USER_PLANS).withDefault("all"),
  kind: parseAsStringLiteral(ADMIN_JOB_KINDS).withDefault("all"),
  action: parseAsString,
  from: parseAsString,
  to: parseAsString,
  range: parseAsStringLiteral(ADMIN_USAGE_RANGES).withDefault("30"),
  after: parseAsString,
  before: parseAsString,
  start: parseAsInteger.withDefault(1),
};

/** Keyset tables go back to their first page whenever a filter changes (Section 24). */
export const FIRST_KEYSET_PAGE = { after: null, before: null, start: null };
