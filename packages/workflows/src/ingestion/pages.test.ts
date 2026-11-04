import { describe, expect, it } from "vitest";
import type { RawLine, RawPage } from "./extraction";
import { processPages } from "./pages";

const body = (text: string, y: number): RawLine => ({ text, size: 11, y });
const page = (pageNumber: number, lines: RawLine[]): RawPage => ({
  pageNumber,
  label: null,
  lines,
});

const PROSE =
  "Restoration crews map every bend of the river before they plant anything along the banks.";

describe("processPages", () => {
  it("removes running headers, footers and page numbers, and keeps the body", () => {
    const endings = [
      "willows hold the soil",
      "sedges slow the water",
      "maps show old channels",
      "floods test the work",
    ];
    const raw = [1, 2, 3, 4].map((n) =>
      page(n, [
        { text: "Journal of River Studies", size: 9, y: 760 },
        ...(n === 1 ? [{ text: "Chapter Two", size: 18, y: 720 }] : []),
        body(`${PROSE} This page adds its own detail.`, 690),
        body(`and the paragraph ends where ${endings[n - 1]}.`, 676),
        { text: `${n}`, size: 9, y: 40 },
      ]),
    );
    const { pages, quality } = processPages(raw);
    expect(quality.removedRepeatedLines).toBe(8);
    for (const processed of pages) {
      expect(processed.text).not.toContain("Journal of River Studies");
      expect(processed.text).toContain("Restoration crews map");
      expect(processed.text).toContain("the paragraph ends where");
      expect(processed.text).not.toMatch(/\n\n\d+$/);
    }
  });

  it("detects headings from font size and records their offsets and levels", () => {
    const { pages, quality } = processPages([
      page(1, [
        { text: "Field Notes on River Restoration", size: 24, y: 740 },
        { text: "1. Mapping the Channel", size: 16, y: 700 },
        body(PROSE, 670),
        body("It continues on the next line.", 656),
      ]),
    ]);
    const [first] = pages;
    expect(first!.headings.map((heading) => [heading.text, heading.level])).toEqual([
      ["Field Notes on River Restoration", 1],
      ["1. Mapping the Channel", 2],
    ]);
    for (const heading of first!.headings) {
      expect(first!.text.slice(heading.offset, heading.offset + heading.text.length)).toBe(
        heading.text,
      );
    }
    expect(quality.bodyFontSize).toBe(11);
  });

  it("joins lines into paragraphs, splits on vertical gaps and mends hyphenation", () => {
    const { pages } = processPages([
      page(1, [
        body("Rivers carry sediment from the hills to the sea and re-", 700),
        body("store their banks over many seasons.", 686),
        body("A new paragraph begins after a gap.", 650),
      ]),
    ]);
    expect(pages[0]!.text).toBe(
      "Rivers carry sediment from the hills to the sea and restore their banks over many seasons.\n\nA new paragraph begins after a gap.",
    );
  });

  it("flags scanned or empty documents as needing OCR", () => {
    const empty = processPages([page(1, []), page(2, []), page(3, [body("12", 40)])]);
    expect(empty.quality.needsOcr).toBe(true);

    const symbols = processPages([page(1, [body("•••• ▪▪▪ ◆◆◆◆ ●●●●● ■■■■ ".repeat(20), 700)])]);
    expect(symbols.quality.needsOcr).toBe(true);

    const text = processPages(
      [1, 2].map((n) => page(n, [body(`${PROSE} ${PROSE} ${PROSE}`, 700), body(PROSE, 686)])),
    );
    expect(text.quality.needsOcr).toBe(false);
    expect(text.quality.pagesWithText).toBe(2);
  });
});
