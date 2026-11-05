import type { Executor } from "@foliomind/db";
import type { CacheKeys } from "@foliomind/domain";
import type { Redis } from "@upstash/redis";
import type { JinaClient } from "../jina";
import { RETRIEVAL } from "./config";
import { embedQuery } from "./embed-query";
import { hybridSearch, type SearchResult } from "./hybrid";
import {
  loadPassages,
  rerankPassages,
  selectPassages,
  type Passage,
  type SelectionOptions,
} from "./rerank";
import type { ResolvedSource } from "./sources";

export * from "./config";
export * from "./embed-query";
export * from "./hybrid";
export * from "./rerank";
export * from "./rewrite";
export * from "./sources";

export interface RetrieveDeps {
  db: Executor;
  jina: JinaClient;
  redis: Redis | null;
  cacheKeys: CacheKeys;
  embeddingModel: string;
  embeddingDimension: number;
}

export interface RetrieveInput {
  userId: string;
  question: string;
  sources: readonly ResolvedSource[];
  focus?: { page: number; text: string } | null | undefined;
  selection?: SelectionOptions;
}

/** Counts, scores and timings only; no question or document text (Section 8 step 7). */
export interface RetrievalMetadata {
  sourceCount: number;
  vectorCandidates: number;
  textCandidates: number;
  mergedCandidates: number;
  rerankedCandidates: number;
  selectedPassages: number;
  topScore: number | null;
  scores: number[];
  embeddingCached: boolean;
  embeddingFailed: boolean;
  rerankFailed: boolean;
  tokens: { embedding: number; rerank: number };
  timings: { embedMs: number; searchMs: number; rerankMs: number; totalMs: number };
}

export interface RetrievalResult {
  passages: Passage[];
  /** Everything the reranker saw, best first; the evaluation compares this with fusion order. */
  ranked: Passage[];
  search: SearchResult;
  metadata: RetrievalMetadata;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Section 8 steps 3–4: embed, search, merge, rerank, select. */
export async function retrieve(deps: RetrieveDeps, input: RetrieveInput): Promise<RetrievalResult> {
  const started = Date.now();
  const versionIds = input.sources.map((source) => source.versionId);
  const queryText = input.focus
    ? `${input.question}\n\n${input.focus.text.slice(0, RETRIEVAL.focusQueryChars)}`
    : input.question;

  let embedding: number[] | null = null;
  let embeddingCached = false;
  let embeddingFailed = false;
  let embeddingTokens = 0;
  try {
    const embedded = await embedQuery(deps, input.userId, queryText);
    embedding = embedded.embedding;
    embeddingCached = embedded.cached;
    embeddingTokens = embedded.tokens;
  } catch {
    // Full-text search can still answer; the run records that embeddings failed.
    embeddingFailed = true;
  }
  const embedded = Date.now();

  const search = await hybridSearch(deps.db, {
    versionIds,
    embedding,
    queryText: input.question,
    focusPage: input.focus?.page,
  });
  const searched = Date.now();

  const candidates = search.merged.slice(0, RETRIEVAL.rerankCandidates);
  const loaded = await loadPassages(deps.db, candidates, input.sources);

  let ranked = loaded;
  let rerankTokens = 0;
  let rerankFailed = false;
  try {
    const result = await rerankPassages(deps, queryText, loaded);
    ranked = result.passages;
    rerankTokens = result.tokens;
  } catch {
    // Fusion order still beats no answer; abstention then relies on Gemini.
    rerankFailed = true;
  }
  const reranked = Date.now();

  const passages = selectPassages(ranked, input.selection);
  const scores = ranked.flatMap((passage) => (passage.score === null ? [] : [passage.score]));
  return {
    passages,
    ranked,
    search,
    metadata: {
      sourceCount: input.sources.length,
      vectorCandidates: search.vector.length,
      textCandidates: search.text.length,
      mergedCandidates: search.merged.length,
      rerankedCandidates: loaded.length,
      selectedPassages: passages.length,
      topScore: scores[0] === undefined ? null : round(scores[0]),
      scores: scores.slice(0, 10).map(round),
      embeddingCached,
      embeddingFailed,
      rerankFailed,
      tokens: { embedding: embeddingTokens, rerank: rerankTokens },
      timings: {
        embedMs: embedded - started,
        searchMs: searched - embedded,
        rerankMs: reranked - searched,
        totalMs: reranked - started,
      },
    },
  };
}
