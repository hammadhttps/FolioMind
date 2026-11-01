import { describe, expect, it } from "vitest";
import { breadcrumbFor, discoverNav, workspaceNav } from "./navigation";

const active = (pathname: string, tab: string | null = null) =>
  [...workspaceNav, ...discoverNav]
    .filter((item) => item.isActive(pathname, tab))
    .map((item) => item.title);

describe("workspace navigation", () => {
  it("marks exactly one item active per page", () => {
    expect(active("/dashboard")).toEqual(["Dashboard"]);
    expect(active("/dashboard", "research")).toEqual(["Research"]);
    expect(active("/dashboard/research/abc")).toEqual(["Research"]);
    expect(active("/read/abc")).toEqual(["My Library"]);
    expect(active("/dashboard/projects/abc")).toEqual(["My Projects"]);
    expect(active("/books/abc")).toEqual(["Explore"]);
    expect(active("/dashboard/settings")).toEqual([]);
  });
});

describe("breadcrumbFor", () => {
  it("names the current page and links its parent", () => {
    expect(breadcrumbFor("/dashboard/projects/abc", null)).toEqual([
      { label: "My Projects", href: "/dashboard/projects" },
      { label: "PDF Studio" },
    ]);
    expect(breadcrumbFor("/dashboard", "research").at(-1)).toEqual({ label: "Research" });
  });
});
