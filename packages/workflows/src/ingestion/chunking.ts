import { createHash } from "node:crypto";
import type { PageHeading } from "./pages";

/*
 * Section 8 step 5: section-aware chunks targeting 600–900 tokens with about
 * 100 tokens of overlap. Sections start at detected headings; paragraphs are
 * packed into chunks, long paragraphs are split at sentences and, failing
 * that, at word boundaries. Very small sections join the next one so a title
 * page does not become its own chunk. These are tuning defaults.
 */

export const CHUNK_TARGET_MIN_TOKENS = 600;
export const CHUNK_TARGET_MAX_TOKENS = 900;
export const CHUNK_OVERLAP_TOKENS = 100;
/** Sections smaller than this are carried into the next section. */
const SMALL_SECTION_TOKENS = 150;

/**
 * Token estimate: characters ÷ 5, calibrated on 2026-11-04 against Jina's
 * reported usage for jina-embeddings-v5-text-small (a prose fixture used 1.26×
 * fewer tokens than characters ÷ 4). Each batch keeps recording both numbers
 * in `ai_runs` so the ratio can be re-checked on real documents.
 */
export const CHARS_PER_TOKEN = 5;
export const estimateTokens = (text: string) =>
  Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));

export interface ChunkPageInput {
  pageNumber: number;
  text: string;
  headings: PageHeading[];
}

export interface Anchor {
  page: number;
  offset: number;
}

export interface Chunk {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  text: string;
  charOffsets: { start: Anchor; end: Anchor };
  tokenCount: number;
  contentHash: string;
}

/** A piece of page text: a paragraph, a sentence or a word-bounded slice. */
interface Unit {
  text: string;
  page: number;
  offset: number;
  tokens: number;
  /** Units that continue a split paragraph join with a space, not a blank line. */
  joinWithSpace: boolean;
}

interface Section {
  heading: string | null;
  units: Unit[];
}

const SENTENCE = /[^.!?。！？]+(?:[.!?。！？]+["'”’)\]]*\s*|$)/gu;

function splitLong(unit: Unit): Unit[] {
  if (unit.tokens <= CHUNK_TARGET_MAX_TOKENS) return [unit];
  const pieces: Unit[] = [];
  const maxChars = CHUNK_TARGET_MAX_TOKENS * CHARS_PER_TOKEN;
  const push = (text: string, start: number) => {
    const trimmed = text.trimEnd();
    if (!trimmed.trim()) return;
    const lead = trimmed.length - trimmed.trimStart().length;
    pieces.push({
      text: trimmed.trim(),
      page: unit.page,
      offset: unit.offset + start + lead,
      tokens: estimateTokens(trimmed.trim()),
      joinWithSpace: pieces.length > 0 || unit.joinWithSpace,
    });
  };

  let buffer = "";
  let bufferStart = 0;
  for (const match of unit.text.matchAll(SENTENCE)) {
    const sentence = match[0];
    const start = match.index ?? 0;
    if (sentence.length > maxChars) {
      if (buffer) push(buffer, bufferStart);
      buffer = "";
      // A "sentence" longer than a chunk: cut at whitespace.
      let cursor = 0;
      while (cursor < sentence.length) {
        let end = Math.min(sentence.length, cursor + maxChars);
        if (end < sentence.length) {
          const space = sentence.lastIndexOf(" ", end);
          if (space > cursor + maxChars / 2) end = space;
        }
        push(sentence.slice(cursor, end), start + cursor);
        cursor = end;
      }
      bufferStart = start + sentence.length;
      continue;
    }
    if (estimateTokens(buffer + sentence) > CHUNK_TARGET_MAX_TOKENS && buffer) {
      push(buffer, bufferStart);
      buffer = "";
      bufferStart = start;
    }
    if (!buffer) bufferStart = start;
    buffer += sentence;
  }
  if (buffer) push(buffer, bufferStart);
  return pieces;
}

/** Splits pages into sections at headings, keeping every paragraph's page offset. */
function sections(pages: readonly ChunkPageInput[]): Section[] {
  const result: Section[] = [{ heading: null, units: [] }];
  for (const page of pages) {
    const headingAt = new Map(page.headings.map((heading) => [heading.offset, heading]));
    let offset = 0;
    for (const paragraph of page.text.split("\n\n")) {
      const heading = headingAt.get(offset);
      if (heading) {
        result.push({ heading: heading.text, units: [] });
      } else if (paragraph.trim()) {
        const unit: Unit = {
          text: paragraph,
          page: page.pageNumber,
          offset,
          tokens: estimateTokens(paragraph),
          joinWithSpace: false,
        };
        result.at(-1)!.units.push(...splitLong(unit));
      }
      offset += paragraph.length + 2;
    }
  }
  return result.filter((section) => section.units.length > 0);
}

function joinUnits(units: readonly Unit[]): string {
  return units
    .map((unit, index) =>
      index === 0 ? unit.text : `${unit.joinWithSpace ? " " : "\n\n"}${unit.text}`,
    )
    .join("");
}

/** The trailing units of a chunk worth about `CHUNK_OVERLAP_TOKENS`, at least one sentence. */
function overlapFrom(units: readonly Unit[]): Unit[] {
  const tail: Unit[] = [];
  let tokens = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    if (tokens + unit.tokens > CHUNK_OVERLAP_TOKENS) {
      if (tail.length === 0) {
        // Take the unit's last sentences instead of the whole unit.
        const sentences = [...unit.text.matchAll(SENTENCE)];
        let text = "";
        for (let s = sentences.length - 1; s >= 0; s -= 1) {
          const candidate = sentences[s]![0] + text;
          if (estimateTokens(candidate) > CHUNK_OVERLAP_TOKENS && text) break;
          text = candidate;
          if (estimateTokens(text) >= CHUNK_OVERLAP_TOKENS) break;
        }
        const trimmed = text.trim();
        if (trimmed && trimmed.length < unit.text.length) {
          tail.unshift({
            text: trimmed,
            page: unit.page,
            offset: unit.offset + unit.text.lastIndexOf(trimmed),
            tokens: estimateTokens(trimmed),
            joinWithSpace: unit.joinWithSpace,
          });
        }
      }
      break;
    }
    tail.unshift(unit);
    tokens += unit.tokens;
  }
  return tail;
}

export function chunkPages(pages: readonly ChunkPageInput[]): Chunk[] {
  const chunks: Chunk[] = [];
  const emit = (units: Unit[], heading: string | null) => {
    if (units.length === 0) return;
    const text = joinUnits(units).trim();
    if (!text) return;
    const first = units[0]!;
    const last = units.at(-1)!;
    chunks.push({
      chunkIndex: chunks.length,
      pageStart: Math.min(...units.map((unit) => unit.page)),
      pageEnd: Math.max(...units.map((unit) => unit.page)),
      heading,
      text,
      charOffsets: {
        start: { page: first.page, offset: first.offset },
        end: { page: last.page, offset: last.offset + last.text.length },
      },
      tokenCount: estimateTokens(text),
      contentHash: createHash("sha256").update(text).digest("hex"),
    });
  };

  let carry: { units: Unit[]; heading: string | null } | null = null;
  const all = sections(pages);
  all.forEach((section, sectionIndex) => {
    // A merged chunk keeps the heading it starts under.
    let heading = carry?.heading ?? section.heading;
    let current: Unit[] = carry ? [...carry.units] : [];
    let fresh = current.reduce((sum, unit) => sum + unit.tokens, 0);
    carry = null;

    for (const unit of section.units) {
      const total = current.reduce((sum, item) => sum + item.tokens, 0);
      if (total + unit.tokens > CHUNK_TARGET_MAX_TOKENS && fresh > 0) {
        emit(current, heading);
        current = overlapFrom(current);
        fresh = 0;
        heading = section.heading;
      }
      current.push(unit);
      fresh += unit.tokens;
    }

    const total = current.reduce((sum, item) => sum + item.tokens, 0);
    const isLast = sectionIndex === all.length - 1;
    if (!isLast && total < SMALL_SECTION_TOKENS && fresh === total) {
      // A tiny section (e.g. a title page) joins the next one.
      carry = { units: current, heading };
    } else if (fresh > 0) {
      emit(current, heading);
    }
  });
  if (carry)
    emit((carry as { units: Unit[] }).units, (carry as { heading: string | null }).heading);
  return chunks;
}
