import { documentChunks, type Executor } from "@foliomind/db";
import { and, inArray } from "drizzle-orm";
import type { JinaClient } from "../jina";
import { RETRIEVAL } from "./config";
import type { ResolvedSource } from "./sources";

/*
 * Section 8 step 4: rerank up to 30 merged candidates with Jina and keep the
 * passages that earn their place in the Gemini context budget. Results map back
 * to chunk IDs through their index, never by text.
 */

export interface Passage {
  chunkId: string;
  versionId: string;
  documentId: string;
  sourceTitle: string;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  text: string;
  tokenCount: number;
  /** Rerank score, or null when reranking was unavailable. */
  score: number | null;
}

/**
 * Loads candidates' text, re-applying the authorized version filter so a chunk
 * ID can never bring in text from outside it.
 */
export async function loadPassages(
  db: Executor,
  candidates: readonly { chunkId: string }[],
  sources: readonly ResolvedSource[],
): Promise<Passage[]> {
  if (candidates.length === 0) return [];
  const byVersion = new Map(sources.map((source) => [source.versionId, source]));
  const rows = await db
    .select({
      chunkId: documentChunks.id,
      versionId: documentChunks.documentVersionId,
      pageStart: documentChunks.pageStart,
      pageEnd: documentChunks.pageEnd,
      heading: documentChunks.heading,
      text: documentChunks.text,
      tokenCount: documentChunks.tokenCount,
    })
    .from(documentChunks)
    .where(
      and(
        inArray(
          documentChunks.id,
          candidates.map((candidate) => candidate.chunkId),
        ),
        inArray(documentChunks.documentVersionId, [...byVersion.keys()]),
      ),
    );
  const byChunk = new Map(rows.map((row) => [row.chunkId, row]));
  return candidates.flatMap(({ chunkId }) => {
    const row = byChunk.get(chunkId);
    const source = row ? byVersion.get(row.versionId) : undefined;
    return row && source
      ? [{ ...row, documentId: source.documentId, sourceTitle: source.title, score: null }]
      : [];
  });
}

export const passageForRanking = (passage: Pick<Passage, "heading" | "text">): string =>
  passage.heading ? `${passage.heading}\n\n${passage.text}` : passage.text;

export async function rerankPassages(
  deps: { jina: JinaClient },
  query: string,
  passages: readonly Passage[],
): Promise<{ passages: Passage[]; tokens: number; model: string }> {
  if (passages.length === 0) return { passages: [], tokens: 0, model: "" };
  const result = await deps.jina.rerank(query, passages.map(passageForRanking), passages.length);
  const ranked: Passage[] = [];
  for (const { index, relevanceScore } of result.results) {
    const passage = passages[index];
    if (passage) ranked.push({ ...passage, score: relevanceScore });
  }
  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { passages: ranked, tokens: result.usage.totalTokens, model: result.model };
}

export interface SelectionOptions {
  maxPassages?: number;
  minPassages?: number;
  tokenBudget?: number;
  floor?: number;
  perSourceMinimum?: number;
}

/**
 * Picks the evidence within the token budget. With several sources in scope, the
 * best few of each come first, whatever their scores: the reranker scores a list
 * together and often rates a comparison's second source low, and the model can
 * say a source is silent but can't describe one it never saw. The remaining room
 * goes to the best passages overall, stopping at the floor once `minPassages` are
 * in. Without scores (reranking failed) passages keep their fusion order.
 */
export function selectPassages(
  ranked: readonly Passage[],
  options: SelectionOptions = {},
): Passage[] {
  const maxPassages = options.maxPassages ?? RETRIEVAL.maxPassages;
  const minPassages = options.minPassages ?? RETRIEVAL.minPassages;
  const tokenBudget = options.tokenBudget ?? RETRIEVAL.contextTokenBudget;
  const floor = options.floor ?? RETRIEVAL.passageFloor;
  const perSource = options.perSourceMinimum ?? RETRIEVAL.perSourceMinimum;

  const selected: Passage[] = [];
  const chosen = new Set<string>();
  let tokens = 0;
  const add = (passage: Passage) => {
    if (chosen.has(passage.chunkId)) return;
    if (selected.length >= maxPassages) return;
    // The first passage always fits, however long it is.
    if (selected.length > 0 && tokens + passage.tokenCount > tokenBudget) return;
    chosen.add(passage.chunkId);
    selected.push(passage);
    tokens += passage.tokenCount;
  };

  const sources = [...new Set(ranked.map((passage) => passage.versionId))];
  if (sources.length > 1) {
    // Round by round, so a cap never leaves the last source with nothing.
    for (let round = 0; round < perSource; round += 1) {
      for (const versionId of sources) {
        const passage = ranked.filter((item) => item.versionId === versionId)[round];
        if (passage) add(passage);
      }
    }
  }
  for (const passage of ranked) {
    if (passage.score !== null && passage.score < floor && selected.length >= minPassages) break;
    add(passage);
  }
  return selected;
}
