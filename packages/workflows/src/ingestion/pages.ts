import type { RawLine, RawPage } from "./extraction";

/*
 * Section 8 steps 3–4: from raw lines to page text. Whitespace is normalized,
 * obvious repeated headers, footers and bare page numbers are removed, and
 * paragraphs and headings are rebuilt from line spacing and font size. The
 * page text stored here is what chunk offsets point into, so anchors stay
 * consistent.
 */

export interface PageHeading {
  /** Character offset of the heading in the page text. */
  offset: number;
  text: string;
  /** 1 is the largest heading size in the document. */
  level: number;
}

export interface ProcessedPage {
  pageNumber: number;
  pageLabel: string | null;
  text: string;
  headings: PageHeading[];
  stats: { chars: number; words: number; removedLines: number };
}

export interface ExtractionQuality {
  pageCount: number;
  pagesWithText: number;
  chars: number;
  words: number;
  /** Share of non-space characters that are letters or digits. */
  alphanumericRatio: number;
  bodyFontSize: number | null;
  headings: number;
  removedRepeatedLines: number;
  needsOcr: boolean;
}

/** A page counts as having text with at least this many non-space characters. */
const MIN_PAGE_CHARS = 40;
/** Headings are at least this much larger than the body text. */
const HEADING_SIZE_RATIO = 1.15;
const MAX_HEADING_CHARS = 120;
const MAX_RUNNING_LINE_CHARS = 100;

const collapse = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\s  -​　]+/g, " ")
    .trim();

const repeatKey = (text: string) =>
  text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

const isPageNumber = (text: string) =>
  /^(page\s+)?[#\divxlc]{1,6}(\s*(of|\/)\s*\d{1,4})?$/i.test(text.trim()) ||
  /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(text.trim());

/** Lines repeated at the top or bottom of many pages are running headers or footers. */
function repeatedEdgeKeys(pages: readonly RawLine[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const edges = new Set<string>();
    const nonEmpty = lines.filter((line) => collapse(line.text));
    for (const line of [...nonEmpty.slice(0, 2), ...nonEmpty.slice(-2)]) {
      const key = repeatKey(collapse(line.text));
      // Running headers and footers are short; long repeated lines are body text.
      if (key.length >= 3 && key.length <= MAX_RUNNING_LINE_CHARS) edges.add(key);
    }
    for (const key of edges) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([key]) => key));
}

/** The most common font size by characters: the document's body text. */
function bodyFontSize(pages: readonly RawPage[]): number | null {
  const weights = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const size = Math.round(line.size * 2) / 2;
      if (size <= 0) continue;
      weights.set(size, (weights.get(size) ?? 0) + collapse(line.text).length);
    }
  }
  let best: number | null = null;
  let bestWeight = 0;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

function looksLikeHeading(text: string, size: number, body: number | null): boolean {
  if (!body || size < body * HEADING_SIZE_RATIO) return false;
  if (text.length < 2 || text.length > MAX_HEADING_CHARS) return false;
  if (!/\p{L}/u.test(text)) return false;
  // Sentences that merely use a large font are not headings.
  return !/[.,;:]$/.test(text) || /^\d+(\.\d+)*\.?\s/.test(text);
}

interface Paragraph {
  text: string;
  heading: boolean;
  size: number;
}

/** Joins lines into paragraphs using vertical gaps, and keeps headings separate. */
function paragraphs(lines: readonly RawLine[], body: number | null): Paragraph[] {
  const result: Paragraph[] = [];
  let current: { parts: string[]; size: number } | null = null;
  let previous: RawLine | null = null;

  const flush = () => {
    if (current && current.parts.length > 0) {
      result.push({
        text: current.parts.join(" ").replace(/\s+/g, " ").trim(),
        heading: false,
        size: current.size,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const text = collapse(line.text);
    if (!text) continue;
    if (looksLikeHeading(text, line.size, body)) {
      flush();
      const last = result.at(-1);
      // Two-line headings of the same size merge.
      if (
        last?.heading &&
        previous &&
        Math.abs(last.size - line.size) < 0.5 &&
        previous.y - line.y < line.size * 2
      ) {
        last.text = `${last.text} ${text}`;
      } else {
        result.push({ text, heading: true, size: line.size });
      }
      previous = line;
      continue;
    }
    const gap = previous ? previous.y - line.y : 0;
    const lineHeight = Math.max(line.size, 1);
    const newParagraph =
      !current ||
      gap > lineHeight * 1.7 ||
      // Moving up the page means a new column or a new block.
      gap < -lineHeight * 0.5 ||
      Math.abs((previous?.size ?? line.size) - line.size) > 1.5;
    if (newParagraph) flush();
    if (!current) current = { parts: [], size: line.size };
    const parts: string[] = current.parts;
    const last = parts.at(-1);
    if (last && /[A-Za-z]-$/.test(last) && /^[a-z]/.test(text)) {
      // A word hyphenated across a line break.
      parts[parts.length - 1] = last.slice(0, -1) + text;
    } else {
      parts.push(text);
    }
    previous = line;
  }
  flush();
  return result;
}

const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/** Turns the child's raw pages into stored page text plus quality metrics. */
export function processPages(raw: readonly RawPage[]): {
  pages: ProcessedPage[];
  quality: ExtractionQuality;
} {
  const repeated = repeatedEdgeKeys(raw.map((page) => page.lines));
  const body = bodyFontSize(raw);
  const headingSizes = new Set<number>();

  const intermediate = raw.map((page) => {
    const nonEmpty = page.lines.filter((line) => collapse(line.text));
    const edgeIndexes = new Set([0, 1, nonEmpty.length - 2, nonEmpty.length - 1]);
    let removed = 0;
    const kept = nonEmpty.filter((line, index) => {
      const text = collapse(line.text);
      if (edgeIndexes.has(index) && (repeated.has(repeatKey(text)) || isPageNumber(text))) {
        removed += 1;
        return false;
      }
      return true;
    });
    const blocks = paragraphs(kept, body);
    for (const block of blocks) if (block.heading) headingSizes.add(Math.round(block.size * 2) / 2);
    return { page, blocks, removed };
  });

  const levels = [...headingSizes].sort((a, b) => b - a);
  let chars = 0;
  let alphanumeric = 0;
  let nonSpace = 0;
  let words = 0;
  let pagesWithText = 0;
  let headings = 0;
  let removedRepeatedLines = 0;

  const pages = intermediate.map(({ page, blocks, removed }) => {
    const parts: string[] = [];
    const pageHeadings: PageHeading[] = [];
    let offset = 0;
    for (const block of blocks) {
      if (parts.length > 0) offset += 2;
      if (block.heading) {
        pageHeadings.push({
          offset,
          text: block.text,
          level: Math.min(3, levels.indexOf(Math.round(block.size * 2) / 2) + 1),
        });
      }
      parts.push(block.text);
      offset += block.text.length;
    }
    const text = parts.join("\n\n");
    const pageNonSpace = text.replace(/\s/g, "").length;
    const pageWords = wordCount(text);
    chars += text.length;
    nonSpace += pageNonSpace;
    alphanumeric += text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    words += pageWords;
    headings += pageHeadings.length;
    removedRepeatedLines += removed;
    if (pageNonSpace >= MIN_PAGE_CHARS) pagesWithText += 1;
    return {
      pageNumber: page.pageNumber,
      pageLabel: page.label,
      text,
      headings: pageHeadings,
      stats: { chars: text.length, words: pageWords, removedLines: removed },
    };
  });

  const alphanumericRatio = nonSpace === 0 ? 0 : alphanumeric / nonSpace;
  const pageCount = raw.length;
  // Section 8: predominantly scanned or empty PDFs are not indexed.
  const needsOcr =
    pageCount === 0 || nonSpace < 200 || pagesWithText / pageCount < 0.5 || alphanumericRatio < 0.5;

  return {
    pages,
    quality: {
      pageCount,
      pagesWithText,
      chars,
      words,
      alphanumericRatio: Math.round(alphanumericRatio * 1000) / 1000,
      bodyFontSize: body,
      headings,
      removedRepeatedLines,
      needsOcr,
    },
  };
}
