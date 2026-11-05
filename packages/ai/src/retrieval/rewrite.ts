import type { GeminiClient, TokenUsage } from "../gemini";
import { buildRewritePrompt, REWRITE_SYSTEM } from "../prompts/rewrite";
import { RETRIEVAL } from "./config";

/*
 * Section 8 step 2: a follow-up such as "and how much did it cost?" can't be
 * searched alone. A short Gemini call rewrites it using bounded history. The
 * result is only ever a search string and the question the answer addresses; it
 * cannot change which sources are searched, which come from the checked scope.
 */

export interface HistoryMessage {
  role: "user" | "assistant";
  body: string;
}

export interface RewriteResult {
  question: string;
  rewritten: boolean;
  /** Set when Gemini was called. */
  run?: { model: string; usage: TokenUsage; latencyMs: number; failed: boolean };
}

const REFERS_BACK =
  /\b(it|its|they|them|their|theirs|this|that|these|those|he|him|his|she|her|hers|one|ones|former|latter|above|previous|earlier|same|else|more|another|other|others|also|too|then|there|why|how come)\b/i;

/** A standalone question skips the call, because Gemini quota is per request. */
export function needsRewrite(question: string, history: readonly HistoryMessage[]): boolean {
  if (history.length === 0) return false;
  const words = question.trim().split(/\s+/).length;
  return words <= 5 || REFERS_BACK.test(question);
}

const MAX_REWRITE_CHARS = 500;

/** Never fails a question: on any trouble the original wording is searched. */
export async function rewriteFollowUp(
  deps: { gemini: GeminiClient; model: string },
  history: readonly HistoryMessage[],
  question: string,
  signal?: AbortSignal,
): Promise<RewriteResult> {
  if (!needsRewrite(question, history)) return { question, rewritten: false };
  const started = Date.now();
  try {
    const result = await deps.gemini.generateText({
      model: deps.model,
      system: REWRITE_SYSTEM,
      prompt: buildRewritePrompt(history, question),
      temperature: 0.1,
      maxOutputTokens: 160,
      thinking: "minimal",
      ...(signal ? { signal } : {}),
    });
    const rewritten = result.text.replace(/\s+/g, " ").trim().slice(0, MAX_REWRITE_CHARS);
    const run = {
      model: result.model,
      usage: result.usage,
      latencyMs: Date.now() - started,
      failed: false,
    };
    return rewritten
      ? { question: rewritten, rewritten: rewritten !== question, run }
      : { question, rewritten: false, run };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      question,
      rewritten: false,
      run: {
        model: deps.model,
        usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - started,
        failed: true,
      },
    };
  }
}

export const historyForRewrite = (messages: readonly HistoryMessage[]): HistoryMessage[] =>
  messages.slice(-RETRIEVAL.historyMessages).map((message) => ({
    role: message.role,
    body: message.body.slice(0, RETRIEVAL.historyChars),
  }));
