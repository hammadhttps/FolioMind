/*
 * Retrieval settings (blueprint Section 8 steps 2–4). These are tuning defaults
 * measured with `pnpm eval:retrieval`; compare embedding-only and reranked
 * results there before changing them.
 */
export const RETRIEVAL = {
  /** Section 8 step 3. */
  vectorCandidates: 20,
  textCandidates: 20,
  /** Reciprocal rank fusion constant; 60 is the value from the original paper. */
  rrfK: 60,
  /** Section 8 step 4. */
  rerankCandidates: 30,
  /** "Roughly 6–10 passages within the Gemini context budget". */
  maxPassages: 8,
  /** Passages kept regardless of the floor, because scores can run low on broad questions. */
  minPassages: 4,
  /** Evidence tokens per question, using the chunker's estimate. */
  contextTokenBudget: 6000,
  /**
   * The best rerank score below which a question is clearly unrelated, so FolioMind
   * says so without asking Gemini. jina-reranker-v3.5 scores aren't bounded to 0-1.
   * Measured 2026-11-07: unrelated questions score -0.09 to -0.18, specific ones
   * 0.14 to 0.75, and broad ones such as "summarize this" only -0.10 to 0.20,
   * because no single passage matches them. So this stays low: refusing a good
   * question is much worse than one extra Gemini request, and the model reports
   * anything the passages don't answer. A cutoff of 0.1 refused most summaries.
   */
  abstainScore: -0.1,
  /** Past `minPassages`, passages under this are left out. Below zero means unrelated. */
  passageFloor: 0,
  /** Each source in scope keeps this many passages, whatever they score. */
  perSourceMinimum: 2,
  /** Messages of history sent to the follow-up rewrite, each cut to `historyChars`. */
  historyMessages: 6,
  historyChars: 800,
  /** How much selected text joins the search query. */
  focusQueryChars: 800,
} as const;

export type RetrievalSettings = typeof RETRIEVAL;
