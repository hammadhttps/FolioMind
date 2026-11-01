import { CATALOG_SORTS, LIBRARY_SORTS, LIBRARY_TYPES } from "@foliomind/contracts/search-params";
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
  sort: parseAsStringLiteral(LIBRARY_SORTS).withDefault("opened"),
};

export const DASHBOARD_TABS = ["overview", "research"] as const;
export const dashboardTabParser = parseAsStringLiteral(DASHBOARD_TABS).withDefault("overview");
