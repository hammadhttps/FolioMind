import { describe, expect, it } from "vitest";
import {
  catalogSearchParamsSchema,
  librarySearchParamsSchema,
  parseSearchParams,
} from "./search-params";

describe("catalogSearchParamsSchema", () => {
  it("applies defaults for an empty URL", () => {
    expect(parseSearchParams(catalogSearchParamsSchema, {})).toEqual({
      q: undefined,
      category: [],
      language: undefined,
      sort: "newest",
      page: 1,
    });
  });

  it("parses valid filters", () => {
    expect(
      parseSearchParams(catalogSearchParamsSchema, {
        q: "  urban design ",
        category: "design,research",
        language: "en",
        sort: "relevance",
        page: "3",
      }),
    ).toEqual({
      q: "urban design",
      category: ["design", "research"],
      language: "en",
      sort: "relevance",
      page: 3,
    });
  });

  it("falls back to defaults instead of failing on malformed values", () => {
    const parsed = parseSearchParams(catalogSearchParamsSchema, {
      q: "a",
      category: "Not A Slug!,design",
      language: "english",
      sort: "price",
      page: "9999",
    });
    expect(parsed).toEqual({
      q: undefined,
      category: [],
      language: undefined,
      sort: "newest",
      page: 1,
    });
  });

  it("only allows relevance sorting with a query", () => {
    expect(parseSearchParams(catalogSearchParamsSchema, { sort: "relevance" }).sort).toBe("newest");
  });

  it("uses the first value of repeated params", () => {
    expect(parseSearchParams(catalogSearchParamsSchema, { page: ["2", "5"] }).page).toBe(2);
  });
});

describe("librarySearchParamsSchema", () => {
  it("defaults the type filter and sort", () => {
    expect(parseSearchParams(librarySearchParamsSchema, { type: "everything" })).toEqual({
      q: undefined,
      type: "all",
      sort: "opened",
    });
  });
});
