import { ProviderError } from "@foliomind/contracts";
import type { GeminiClient, GeminiThinkingLevel, StreamEnd } from "../gemini";
import { buildAnswerPrompt, buildAnswerSystem, INSUFFICIENT_EVIDENCE } from "../prompts/answer";
import type { LabeledPassage } from "./citations";

/*
 * The Gemini answer (Section 8 steps 5–6), streamed as it arrives. The marker
 * for "the passages don't answer this" is held back and removed, so a reader
 * only ever sees the explanation.
 */

/** Low temperature for cited answers (Section 8); thinking off keeps first words quick. */
export const ANSWER_SETTINGS = {
  temperature: 0.2,
  maxOutputTokens: 1024,
  thinking: "minimal" as GeminiThinkingLevel,
};

export interface AnswerInput {
  question: string;
  passages: readonly LabeledPassage[];
  focus?: { page: number; text: string } | null | undefined;
  sourceCount: number;
  signal?: AbortSignal | undefined;
}

export interface AnswerResult {
  /** The text a reader sees; citation markers are still as the model wrote them. */
  text: string;
  /** The model reported that the passages don't answer the question. */
  insufficient: boolean;
  end: StreamEnd | null;
  firstTokenMs: number | null;
  /** The call that produced a first word; 2 after one retry. */
  attempts: number;
}

const visibleText = (raw: string, insufficient: boolean): string =>
  insufficient ? raw.trimStart().slice(INSUFFICIENT_EVIDENCE.length).trimStart() : raw;

export interface AnswerDeps {
  gemini: GeminiClient;
  model: string;
  /**
   * Used when `model` has no quota left. The free tier allows 20 requests a day
   * per model and per project, so a second model keeps answers coming.
   */
  fallbackModel?: string | undefined;
}

/** Yields text as it arrives and returns the whole answer. */
export async function* streamAnswer(
  deps: AnswerDeps,
  input: AnswerInput,
): AsyncGenerator<string, AnswerResult> {
  const system = buildAnswerSystem({ sourceCount: input.sourceCount });
  const prompt = buildAnswerPrompt({
    question: input.question,
    passages: input.passages,
    focus: input.focus,
  });
  const started = Date.now();
  let raw = "";
  let forwarded = 0;
  let decided = false;
  let insufficient = false;
  let end: StreamEnd | null = null;
  let firstTokenMs: number | null = null;
  let attempts = 0;
  let model = deps.model;
  let retried = false;

  const pending = (): string => {
    const visible = visibleText(raw, insufficient);
    const delta = visible.slice(forwarded);
    forwarded = visible.length;
    return delta;
  };

  for (;;) {
    attempts += 1;
    try {
      const stream = deps.gemini.streamText({
        model,
        system,
        prompt,
        ...ANSWER_SETTINGS,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      for await (const chunk of stream) {
        if ("usage" in chunk) {
          end = chunk;
          continue;
        }
        firstTokenMs ??= Date.now() - started;
        raw += chunk.text;
        if (!decided) {
          const head = raw.trimStart();
          if (head.startsWith(INSUFFICIENT_EVIDENCE)) {
            decided = true;
            insufficient = true;
          } else if (head.length >= INSUFFICIENT_EVIDENCE.length) {
            decided = true;
          } else if (!INSUFFICIENT_EVIDENCE.startsWith(head)) {
            decided = true;
          } else {
            continue;
          }
        }
        const delta = pending();
        if (delta) yield delta;
      }
      break;
    } catch (error) {
      if (raw !== "" || input.signal?.aborted || !(error instanceof ProviderError)) throw error;
      if (!error.retryable) throw error;
      // One quick retry for a passing failure, before the reader has seen any words. A 429
      // means the quota is spent, so asking the same model again at once would only fail.
      if (error.status !== 429 && !retried) {
        retried = true;
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      // No quota, or still overloaded: another model may be able to answer.
      if (!deps.fallbackModel || model === deps.fallbackModel) throw error;
      model = deps.fallbackModel;
      retried = false;
    }
  }
  // Short replies can end before the marker check decides.
  const rest = pending();
  if (rest) yield rest;
  return { text: visibleText(raw, insufficient).trim(), insufficient, end, firstTokenMs, attempts };
}
