import { describe, expect, it } from "vitest";
import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_MAX_TOKENS,
  CHUNK_TARGET_MIN_TOKENS,
  chunkPages,
  estimateTokens,
  type ChunkPageInput,
} from "./chunking";

const sentence = (n: number) =>
  `Sentence ${n} explains how rivers move sediment and why restoration takes patience.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

/** Pages of paragraphs, with a heading at the start of selected pages. */
function pages(spec: { paragraphs: string[]; heading?: string }[]): ChunkPageInput[] {
  return spec.map((page, index) => {
    const parts = [...(page.heading ? [page.heading] : []), ...page.paragraphs];
    return {
      pageNumber: index + 1,
      text: parts.join("\n\n"),
      headings: page.heading ? [{ offset: 0, text: page.heading, level: 1 }] : [],
    };
  });
}

describe("chunkPages", () => {
  it("packs a long section into 600–900 token chunks with about 100 tokens of overlap", () => {
    const input = pages(
      Array.from({ length: 6 }, (_, p) => ({
        heading: p === 0 ? "Introduction" : undefined,
        paragraphs: Array.from({ length: 4 }, (_, i) => paragraph(p * 100 + i * 10, 6)),
      })),
    );
    const chunks = chunkPages(input);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(
        CHUNK_TARGET_MIN_TOKENS - CHUNK_OVERLAP_TOKENS,
      );
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_MAX_TOKENS + CHUNK_OVERLAP_TOKENS);
      expect(chunk.heading).toBe("Introduction");
    }
    // Consecutive chunks share text: the next chunk starts with the previous one's tail.
    const [first, second] = chunks;
    const overlap = second!.text.slice(0, 60);
    expect(first!.text).toContain(overlap);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("records page ranges and character offsets that point back into the page text", () => {
    const input = pages([
      { heading: "Methods", paragraphs: [paragraph(1, 20)] },
      { paragraphs: [paragraph(30, 20)] },
      { paragraphs: [paragraph(60, 20)] },
    ]);
    const chunks = chunkPages(input);
    for (const chunk of chunks) {
      const startPage = input[chunk.charOffsets.start.page - 1]!;
      const start = chunk.charOffsets.start.offset;
      expect(chunk.text.startsWith(startPage.text.slice(start, start + 30))).toBe(true);
      const endPage = input[chunk.charOffsets.end.page - 1]!;
      const end = chunk.charOffsets.end.offset;
      expect(chunk.text.endsWith(endPage.text.slice(end - 30, end))).toBe(true);
      expect(chunk.pageStart).toBeLessThanOrEqual(chunk.pageEnd);
    }
    expect(chunks[0]!.pageStart).toBe(1);
    expect(chunks.at(-1)!.pageEnd).toBe(3);
  });

  it("starts new chunks at headings and joins a tiny section to the next one", () => {
    const input = pages([
      { heading: "Field Notes", paragraphs: ["A short title page."] },
      { heading: "Chapter One", paragraphs: [paragraph(1, 12)] },
      { heading: "Chapter Two", paragraphs: [paragraph(50, 12)] },
    ]);
    const chunks = chunkPages(input);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.heading).toBe("Field Notes");
    expect(chunks[0]!.text).toContain("A short title page.");
    expect(chunks[0]!.pageStart).toBe(1);
    expect(chunks[0]!.pageEnd).toBe(2);
    expect(chunks[1]!.heading).toBe("Chapter Two");
    expect(chunks[1]!.text).not.toContain("Sentence 1 ");
  });

  it("splits a paragraph longer than a chunk at sentences, and a run-on at words", () => {
    const longParagraph = paragraph(1, 120);
    const runOn = "word ".repeat(5000).trim();
    const chunks = chunkPages(pages([{ paragraphs: [longParagraph] }, { paragraphs: [runOn] }]));
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_MAX_TOKENS + CHUNK_OVERLAP_TOKENS);
    }
    expect(chunks.length).toBeGreaterThan(4);
  });

  it("is deterministic, with content hashes of the chunk text", () => {
    const input = pages([{ heading: "Notes", paragraphs: [paragraph(1, 30)] }]);
    const a = chunkPages(input);
    expect(chunkPages(input)).toEqual(a);
    expect(a[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns nothing for pages without text", () => {
    expect(chunkPages(pages([{ paragraphs: [] }, { paragraphs: [""] }]))).toEqual([]);
  });

  it("estimates about five characters per token", () => {
    expect(estimateTokens("x".repeat(500))).toBe(100);
    expect(estimateTokens("")).toBe(1);
  });
});
