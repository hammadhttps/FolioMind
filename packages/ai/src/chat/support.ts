import { ProviderError, type CitationSupport } from "@foliomind/contracts";
import type { GeminiClient, TokenUsage } from "../gemini";
import { buildSupportPrompt, SUPPORT_SYSTEM, supportResultSchema } from "../prompts/support";
import { extractClaims, type LabeledPassage } from "./citations";

/*
 * The citation check (Section 8 step 6). A label is flagged when a sentence
 * citing it has no support from any of the passages it cites. A failed check
 * leaves citations `unchecked`: it never affects an answer already given.
 */

export interface SupportVerdict {
  label: string;
  support: CitationSupport;
}

export interface SupportResult {
  verdicts: SupportVerdict[];
  claims: number;
  unsupportedClaims: number;
  run: { model: string; usage: TokenUsage; latencyMs: number; status: "succeeded" | "failed" };
}

export async function checkSupport(
  deps: { gemini: GeminiClient; model: string },
  input: {
    body: string;
    passages: readonly LabeledPassage[];
    signal?: AbortSignal;
    retryDelayMs?: number;
  },
): Promise<SupportResult | null> {
  const claims = extractClaims(input.body);
  if (claims.length === 0) return null;
  const cited = new Set(claims.flatMap((claim) => claim.labels));
  const passages = input.passages.filter((passage) => cited.has(passage.label));

  const started = Date.now();
  const request = () =>
    deps.gemini.generateStructured(supportResultSchema, {
      model: deps.model,
      system: SUPPORT_SYSTEM,
      prompt: buildSupportPrompt({
        passages: passages.map((passage) => ({ label: passage.label, text: passage.text })),
        claims,
      }),
      temperature: 0,
      // Up to 12 claims with a few labels each, and no thinking.
      maxOutputTokens: 600,
      thinking: "minimal",
      ...(input.signal ? { signal: input.signal } : {}),
    });
  try {
    // "High demand" 503s come and go within a second (measured 2026-11-05). A 429 won't.
    const result = await request().catch(async (error: unknown) => {
      if (!(error instanceof ProviderError) || !error.retryable || error.status === 429) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, input.retryDelayMs ?? 600));
      return request();
    });
    const flagged = new Set<string>();
    const passed = new Set<string>();
    let unsupportedClaims = 0;
    for (const claim of claims) {
      const answer = result.data.results.find((item) => item.claim === claim.id);
      if (!answer) continue;
      const supporting = answer.supportedBy.filter((label) => claim.labels.includes(label));
      if (supporting.length === 0) {
        unsupportedClaims += 1;
        claim.labels.forEach((label) => flagged.add(label));
      } else {
        claim.labels.forEach((label) => passed.add(label));
      }
    }
    const verdicts: SupportVerdict[] = [...cited].flatMap((label): SupportVerdict[] => {
      if (flagged.has(label)) return [{ label, support: "unsupported" }];
      return passed.has(label) ? [{ label, support: "supported" }] : [];
    });
    return {
      verdicts,
      claims: claims.length,
      unsupportedClaims,
      run: {
        model: result.model,
        usage: result.usage,
        latencyMs: Date.now() - started,
        status: "succeeded",
      },
    };
  } catch {
    return {
      verdicts: [],
      claims: claims.length,
      unsupportedClaims: 0,
      run: {
        model: deps.model,
        usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - started,
        status: "failed",
      },
    };
  }
}
