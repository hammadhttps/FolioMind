import {
  CATALOG_SORTS,
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
