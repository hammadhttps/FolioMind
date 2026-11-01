import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookCover, COVER_VARIANTS, coverVariantFor } from "./book-cover";
import { initialsOf } from "./user-avatar";

describe("coverVariantFor", () => {
  it("is deterministic and uses every variant across many IDs", () => {
    expect(coverVariantFor("book-1")).toBe(coverVariantFor("book-1"));
    const seen = new Set(
      Array.from({ length: 200 }, (_, index) => coverVariantFor(`book-${index}`)),
    );
    expect([...seen].sort()).toEqual(Object.keys(COVER_VARIANTS).sort());
  });
});

describe("BookCover", () => {
  it("is decorative by default and an image with a label when standalone", () => {
    const { rerender, container } = render(<BookCover id="x" title="Rivers" author="A. Writer" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    rerender(<BookCover id="x" title="Rivers" author="A. Writer" decorative={false} />);
    expect(screen.getByRole("img", { name: "Cover of Rivers by A. Writer" })).toBeInTheDocument();
  });
});

describe("initialsOf", () => {
  it("uses first and last names, or the first two letters", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("Mary Ann Evans")).toBe("ME");
    expect(initialsOf("plato")).toBe("PL");
    expect(initialsOf("  ")).toBe("?");
  });
});
