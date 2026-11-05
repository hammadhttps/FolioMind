import type { TokenUsage } from "./gemini";

/*
 * Estimates for `ai_runs.estimated_cost` and the evaluation report (Section 8),
 * never for billing a reader. The Gemini key is on the free tier today, so real
 * spend is zero; these are what the same usage would cost on the paid tier.
 *
 * Gemini: Standard tier, USD per million tokens, from
 * https://ai.google.dev/gemini-api/docs/pricing (read 2026-11-05). Flash prices
 * double on 2027-01-01. Thinking tokens bill at the output rate.
 *
 * Jina publishes no per-token price on its own pages (checked 2026-11-05);
 * $0.05 per million is the figure third-party price lists most often give.
 */
const GEMINI_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
};
/** Unknown models price as the flash tier rather than as free. */
const FALLBACK = { input: 0.75, output: 3.75 };

const JINA_PER_MILLION = 0.05;

export function estimateGeminiCost(model: string, usage: TokenUsage): number {
  const price = GEMINI_PER_MILLION[model] ?? FALLBACK;
  return (
    (usage.inputTokens * price.input + (usage.outputTokens + usage.thoughtTokens) * price.output) /
    1_000_000
  );
}

export const estimateJinaCost = (tokens: number): number => (tokens * JINA_PER_MILLION) / 1_000_000;
