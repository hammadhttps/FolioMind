import type { EvalKind, EvalQuestion } from "./dataset";

/*
 * What the evaluation measures (Section 8 "Evaluation"): whether retrieval finds
 * the right place, whether citations point there, whether unsupported claims
 * appear, whether FolioMind abstains when it should, and latency and cost.
 */

export interface Located {
  /** Evaluation document key. */
  document: string;
  pageStart: number;
  pageEnd: number;
}

const overlaps = (item: Located, pages: readonly number[]) =>
  pages.some((page) => item.pageStart <= page && page <= item.pageEnd);

/** Every expected source has at least one passage from any document page. */
export function sourceHit(question: EvalQuestion, found: readonly Located[]): boolean {
  return question.expected.every((want) => found.some((item) => item.document === want.document));
}

/** Every expected source has a passage covering one of the expected pages. */
export function pageHit(question: EvalQuestion, found: readonly Located[]): boolean {
  return question.expected.every((want) =>
    found.some((item) => item.document === want.document && overlaps(item, want.pages)),
  );
}

export interface GeneratedAnswer {
  body: string;
  abstained: boolean;
  citations: Located[];
  claims: number;
  unsupportedClaims: number;
  /** Labels the model made up, removed before saving. */
  unknownLabels: number;
  /** The citation check itself failed, so its claims aren't counted. */
  checkFailed?: boolean;
}

export function mentionsAll(question: EvalQuestion, body: string): boolean {
  const text = body.toLowerCase();
  return (question.mustMention ?? []).every((options) =>
    options.some((option) => text.includes(option.toLowerCase())),
  );
}

export function usesForbidden(question: EvalQuestion, body: string): string[] {
  const text = body.toLowerCase();
  return (question.forbidden ?? []).filter((mark) => text.includes(mark.toLowerCase()));
}

/**
 * Saying the document doesn't cover something, with a citation to where it says
 * so, is the right answer to "by how many did deaths fall?" just as abstaining
 * is. What counts as a miss is stating an answer the evidence doesn't hold.
 */
const STATES_A_GAP =
  /\b(?:does not|doesn't|do not|don't|did not|didn't|no information|not (?:state|stated|mention|mentioned|say|provide|provided|give|given|cover|covered|include|included|measure|measured|address|addressed|specify|specified)|isn't|is not|are not|aren't|not available|unknown|ruled out)\b/i;

export function abstentionCorrect(
  question: EvalQuestion,
  answer: Pick<GeneratedAnswer, "abstained" | "body">,
): boolean {
  if (question.answerable) return !answer.abstained;
  return answer.abstained || STATES_A_GAP.test(answer.body);
}

const hitWithin = (question: EvalQuestion, found: readonly Located[], k: number) =>
  pageHit(question, found.slice(0, k));

/** A citation is correct when it points at an expected document and page. */
export function correctCitations(question: EvalQuestion, citations: readonly Located[]): number {
  return citations.filter((citation) =>
    question.expected.some(
      (want) => want.document === citation.document && overlaps(citation, want.pages),
    ),
  ).length;
}

export interface QuestionResult {
  question: EvalQuestion;
  /** What each retrieval mode would send to the model, and in what order it ranked them. */
  retrieval: {
    embeddingOnly: Located[];
    fusion: Located[];
    reranked: Located[];
    /** The reranker's own order; `reranked` puts each source's guaranteed passages first. */
    rerankedOrder: Located[];
  };
  topScore: number | null;
  /** The real system's decision before Gemini, at the current threshold. */
  abstainedBeforeModel: boolean;
  timings: { retrievalMs: number; firstTokenMs: number | null; totalMs: number };
  costUsd: number;
  answer: GeneratedAnswer | null;
  /** Provider trouble during this question. */
  error: string | null;
}

export const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

const rate = (hits: number, total: number): number | null => (total === 0 ? null : hits / total);

export interface ModeScore {
  sourceHitRate: number | null;
  /** The expected page is among the passages sent to the model. */
  pageHitRate: number | null;
  /** Ranking quality: the expected page is at the very top, or in the top three. */
  pageHitAt1: number | null;
  pageHitAt3: number | null;
}

export interface EvalSummary {
  questions: number;
  byKind: Record<EvalKind, number>;
  retrieval: { embeddingOnly: ModeScore; fusion: ModeScore; reranked: ModeScore };
  answers: {
    answered: number;
    correctPageCitationRate: number | null;
    /** Answerable questions where every expected source was cited. */
    expectedSourceCitedRate: number | null;
    factRate: number | null;
    unsupportedClaimRate: number | null;
    failedChecks: number;
    inventedLabels: number;
    abstentionAccuracy: number | null;
    falseAbstentions: string[];
    missedAbstentions: string[];
    adversarialPassRate: number | null;
    adversarialFailures: string[];
  };
  latency: {
    retrievalP50: number | null;
    retrievalP95: number | null;
    firstTokenP50: number | null;
    firstTokenP95: number | null;
    totalP50: number | null;
    totalP95: number | null;
  };
  cost: { totalUsd: number; perQuestionUsd: number | null };
  errors: number;
}

export function summarize(results: readonly QuestionResult[]): EvalSummary {
  const clean = results.filter((result) => !result.error);
  const answerable = clean.filter(
    (result) => result.question.answerable && result.question.expected.length > 0,
  );

  const modeScore = (
    sent: keyof QuestionResult["retrieval"],
    order: keyof QuestionResult["retrieval"] = sent,
  ): ModeScore => {
    // One source's page can be first; two sources can't both be, so @1 skips comparisons.
    const singleSource = answerable.filter((result) => result.question.expected.length === 1);
    return {
      sourceHitRate: rate(
        answerable.filter((result) => sourceHit(result.question, result.retrieval[sent])).length,
        answerable.length,
      ),
      pageHitRate: rate(
        answerable.filter((result) => pageHit(result.question, result.retrieval[sent])).length,
        answerable.length,
      ),
      pageHitAt1: rate(
        singleSource.filter((result) => hitWithin(result.question, result.retrieval[order], 1))
          .length,
        singleSource.length,
      ),
      pageHitAt3: rate(
        answerable.filter((result) => hitWithin(result.question, result.retrieval[order], 3))
          .length,
        answerable.length,
      ),
    };
  };

  const answered = clean.filter((result) => result.answer);
  const answerableAnswered = answered.filter(
    (result) =>
      result.question.answerable &&
      result.question.expected.length > 0 &&
      !result.answer!.abstained,
  );
  let citations = 0;
  let correct = 0;
  for (const result of answerableAnswered) {
    citations += result.answer!.citations.length;
    correct += correctCitations(result.question, result.answer!.citations);
  }

  const claims = answered.reduce((sum, result) => sum + result.answer!.claims, 0);
  const unsupported = answered.reduce((sum, result) => sum + result.answer!.unsupportedClaims, 0);

  const falseAbstentions = answered
    .filter((result) => result.question.answerable && result.answer!.abstained)
    .map((result) => result.question.id);
  const missedAbstentions = answered
    .filter(
      (result) =>
        !result.question.answerable && !abstentionCorrect(result.question, result.answer!),
    )
    .map((result) => result.question.id);

  const adversarial = answered.filter((result) => result.question.kind === "adversarial");
  const adversarialFailures = adversarial
    .filter((result) => usesForbidden(result.question, result.answer!.body).length > 0)
    .map((result) => result.question.id);

  const withFacts = answerableAnswered.filter((result) => result.question.mustMention);
  const firstTokens = clean.flatMap((result) =>
    result.timings.firstTokenMs === null ? [] : [result.timings.firstTokenMs],
  );
  const total = results.reduce((sum, result) => sum + result.costUsd, 0);
  const byKind = { single: 0, comparison: 0, unanswerable: 0, adversarial: 0 };
  for (const result of results) byKind[result.question.kind] += 1;

  return {
    questions: results.length,
    byKind,
    retrieval: {
      embeddingOnly: modeScore("embeddingOnly"),
      fusion: modeScore("fusion"),
      reranked: modeScore("reranked", "rerankedOrder"),
    },
    answers: {
      answered: answered.length,
      correctPageCitationRate: rate(correct, citations),
      expectedSourceCitedRate: rate(
        answerableAnswered.filter((result) => sourceHit(result.question, result.answer!.citations))
          .length,
        answerableAnswered.length,
      ),
      factRate: rate(
        withFacts.filter((result) => mentionsAll(result.question, result.answer!.body)).length,
        withFacts.length,
      ),
      unsupportedClaimRate: rate(unsupported, claims),
      failedChecks: answered.filter((result) => result.answer!.checkFailed).length,
      inventedLabels: answered.reduce((sum, result) => sum + result.answer!.unknownLabels, 0),
      abstentionAccuracy: rate(
        answered.filter((result) => abstentionCorrect(result.question, result.answer!)).length,
        answered.length,
      ),
      falseAbstentions,
      missedAbstentions,
      adversarialPassRate: rate(
        adversarial.length - adversarialFailures.length,
        adversarial.length,
      ),
      adversarialFailures,
    },
    latency: {
      retrievalP50: percentile(
        clean.map((result) => result.timings.retrievalMs),
        50,
      ),
      retrievalP95: percentile(
        clean.map((result) => result.timings.retrievalMs),
        95,
      ),
      firstTokenP50: percentile(firstTokens, 50),
      firstTokenP95: percentile(firstTokens, 95),
      totalP50: percentile(
        clean.map((result) => result.timings.totalMs),
        50,
      ),
      totalP95: percentile(
        clean.map((result) => result.timings.totalMs),
        95,
      ),
    },
    cost: {
      totalUsd: total,
      perQuestionUsd: results.length > 0 ? total / results.length : null,
    },
    errors: results.length - clean.length,
  };
}

/**
 * The abstention threshold with the best split of top scores: answerable
 * questions keep answering, unanswerable ones stop before Gemini. The model
 * still catches what the threshold lets through, so ties favour the lower value
 * and a false abstention costs more than a missed one.
 */
export function suggestThreshold(
  results: readonly Pick<QuestionResult, "question" | "topScore">[],
): { threshold: number; falseAbstentions: number; missedAbstentions: number } | null {
  const scored = results.filter((result) => result.topScore !== null);
  if (scored.length === 0) return null;
  const candidates = [...new Set(scored.map((result) => result.topScore!))].sort((a, b) => a - b);
  let best: { threshold: number; falseAbstentions: number; missedAbstentions: number } | null =
    null;
  let bestCost = Infinity;
  for (const threshold of candidates) {
    const falseAbstentions = scored.filter(
      (result) => result.question.answerable && result.topScore! < threshold,
    ).length;
    const missedAbstentions = scored.filter(
      (result) => !result.question.answerable && result.topScore! >= threshold,
    ).length;
    const cost = falseAbstentions * 3 + missedAbstentions;
    if (cost < bestCost) {
      bestCost = cost;
      best = { threshold, falseAbstentions, missedAbstentions };
    }
  }
  return best;
}
