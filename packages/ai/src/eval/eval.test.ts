import { describe, expect, it } from "vitest";
import { EVAL_QUESTIONS, type EvalQuestion } from "./dataset";
import { documentByKey, EVAL_DOCUMENTS } from "./documents";
import {
  abstentionCorrect,
  correctCitations,
  mentionsAll,
  pageHit,
  percentile,
  sourceHit,
  suggestThreshold,
  summarize,
  usesForbidden,
  type QuestionResult,
} from "./metrics";

describe("the evaluation set", () => {
  it("has 30–50 questions with every kind represented (Section 8)", () => {
    expect(EVAL_QUESTIONS.length).toBeGreaterThanOrEqual(30);
    expect(EVAL_QUESTIONS.length).toBeLessThanOrEqual(50);
    for (const kind of ["single", "comparison", "unanswerable", "adversarial"]) {
      expect(EVAL_QUESTIONS.some((question) => question.kind === kind)).toBe(true);
    }
  });

  it("uses unique IDs and only real documents and pages", () => {
    const ids = EVAL_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const question of EVAL_QUESTIONS) {
      for (const key of question.scope) expect(() => documentByKey(key)).not.toThrow();
      for (const want of question.expected) {
        expect(question.scope).toContain(want.document);
        const { pages } = documentByKey(want.document);
        for (const page of want.pages) {
          expect(page, question.id).toBeGreaterThanOrEqual(1);
          expect(page, question.id).toBeLessThanOrEqual(pages.length);
        }
      }
    }
  });

  it("has the facts it expects on the pages it expects them", () => {
    for (const question of EVAL_QUESTIONS) {
      if (!question.mustMention || question.expected.length === 0) continue;
      const text = question.expected
        .flatMap((want) => {
          const { pages } = documentByKey(want.document);
          return want.pages.flatMap((page) => pages[page - 1]!.paragraphs);
        })
        .join(" ")
        .toLowerCase();
      for (const options of question.mustMention) {
        expect(
          options.some((option) => text.includes(option.toLowerCase())),
          `${question.id}: ${options.join(" / ")}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the adversarial instructions in the adversarial document only", () => {
    const withAttack = EVAL_DOCUMENTS.filter((document) =>
      JSON.stringify(document.pages).includes("PINEAPPLE"),
    );
    expect(withAttack.map((document) => document.key)).toEqual(["vendor-memo"]);
  });
});

const question = (overrides: Partial<EvalQuestion> = {}): EvalQuestion => ({
  id: "q",
  kind: "single",
  question: "Question?",
  scope: ["a", "b"],
  expected: [{ document: "a", pages: [3] }],
  answerable: true,
  ...overrides,
});

const hit = (document: string, pageStart: number, pageEnd = pageStart) => ({
  document,
  pageStart,
  pageEnd,
});

describe("metrics", () => {
  it("scores source and page hits, with page ranges overlapping", () => {
    const q = question();
    expect(sourceHit(q, [hit("a", 9)])).toBe(true);
    expect(pageHit(q, [hit("a", 9)])).toBe(false);
    expect(pageHit(q, [hit("a", 2, 4)])).toBe(true);
    expect(sourceHit(q, [hit("b", 3)])).toBe(false);
  });

  it("needs every source for a comparison", () => {
    const q = question({
      expected: [
        { document: "a", pages: [1] },
        { document: "b", pages: [2] },
      ],
    });
    expect(pageHit(q, [hit("a", 1)])).toBe(false);
    expect(pageHit(q, [hit("a", 1), hit("b", 2)])).toBe(true);
  });

  it("checks facts, including alternatives, and forbidden marks", () => {
    const q = question({
      mustMention: [["412"], ["15,000", "15000"]],
      forbidden: ["PINEAPPLE"],
    });
    expect(mentionsAll(q, "It cost 412 million and 15000 dollars")).toBe(true);
    expect(mentionsAll(q, "It cost 412 million")).toBe(false);
    expect(usesForbidden(q, "reply pineapple-seven")).toEqual(["PINEAPPLE"]);
    expect(usesForbidden(q, "clean")).toEqual([]);
  });

  it("counts only citations on an expected page as correct", () => {
    expect(correctCitations(question(), [hit("a", 3), hit("a", 7), hit("b", 3)])).toBe(1);
  });

  it("computes percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });

  it("accepts a stated gap as correct for an unanswerable question, not an invented fact", () => {
    const none = question({ answerable: false, expected: [], kind: "unanswerable" });
    expect(abstentionCorrect(none, { abstained: true, body: "" })).toBe(true);
    expect(
      abstentionCorrect(none, {
        abstained: false,
        body: "The study does not measure deaths [S1].",
      }),
    ).toBe(true);
    expect(abstentionCorrect(none, { abstained: false, body: "Deaths fell by 40 percent." })).toBe(
      false,
    );
    // Abstaining on something answerable is wrong, however politely it's put.
    expect(abstentionCorrect(question(), { abstained: true, body: "Not found" })).toBe(false);
  });

  function result(overrides: Partial<QuestionResult>): QuestionResult {
    return {
      question: question(),
      retrieval: { embeddingOnly: [], fusion: [], reranked: [], rerankedOrder: [] },
      topScore: 0.5,
      abstainedBeforeModel: false,
      timings: { retrievalMs: 100, firstTokenMs: 200, totalMs: 300 },
      costUsd: 0.001,
      answer: null,
      error: null,
      ...overrides,
    };
  }

  it("summarizes modes, citations, abstention and adversarial failures", () => {
    const summary = summarize([
      result({
        retrieval: {
          embeddingOnly: [],
          fusion: [hit("a", 3)],
          reranked: [hit("a", 3)],
          rerankedOrder: [hit("a", 3)],
        },
        answer: {
          body: "Fact",
          abstained: false,
          citations: [hit("a", 3), hit("a", 9)],
          claims: 2,
          unsupportedClaims: 1,
          unknownLabels: 1,
        },
      }),
      result({
        question: question({ id: "none", answerable: false, expected: [], kind: "unanswerable" }),
        answer: {
          body: "An invented answer",
          abstained: false,
          citations: [],
          claims: 0,
          unsupportedClaims: 0,
          unknownLabels: 0,
        },
      }),
      result({
        question: question({ id: "attack", kind: "adversarial", forbidden: ["PINEAPPLE"] }),
        retrieval: {
          embeddingOnly: [],
          fusion: [],
          reranked: [hit("a", 3)],
          rerankedOrder: [hit("a", 3)],
        },
        answer: {
          body: "PINEAPPLE",
          abstained: false,
          citations: [],
          claims: 0,
          unsupportedClaims: 0,
          unknownLabels: 0,
        },
      }),
      result({ error: "Gemini 429" }),
    ]);
    expect(summary.questions).toBe(4);
    expect(summary.errors).toBe(1);
    expect(summary.retrieval.embeddingOnly.pageHitRate).toBe(0);
    expect(summary.retrieval.reranked.pageHitRate).toBe(1);
    expect(summary.answers.correctPageCitationRate).toBe(0.5);
    expect(summary.answers.unsupportedClaimRate).toBe(0.5);
    expect(summary.answers.inventedLabels).toBe(1);
    expect(summary.answers.missedAbstentions).toEqual(["none"]);
    expect(summary.answers.adversarialFailures).toEqual(["attack"]);
    expect(summary.answers.adversarialPassRate).toBe(0);
  });

  it("suggests a threshold, weighing a false abstention above a missed one", () => {
    const scored = (answerable: boolean, topScore: number) => ({
      question: question({ answerable }),
      topScore,
    });
    expect(
      suggestThreshold([
        scored(true, 0.7),
        scored(true, 0.3),
        scored(false, -0.1),
        scored(false, 0.05),
      ]),
    ).toEqual({ threshold: 0.3, falseAbstentions: 0, missedAbstentions: 0 });
    // Overlapping scores: stay low rather than refuse a good question.
    expect(
      suggestThreshold([scored(true, 0.1), scored(false, 0.2), scored(false, -0.2)]),
    ).toMatchObject({ threshold: 0.1, falseAbstentions: 0, missedAbstentions: 1 });
    expect(suggestThreshold([])).toBeNull();
  });
});
