import { ProviderError } from "@foliomind/contracts";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../gemini";
import type { LabeledPassage } from "./citations";
import { checkSupport } from "./support";

const passages = [{ label: "S1", text: "The barrier cost 412 million." }] as LabeledPassage[];
const usage = { inputTokens: 1, outputTokens: 1, thoughtTokens: 0, totalTokens: 2 };
const verdict = (supportedBy: string[]) => ({
  model: "fast",
  usage,
  data: { results: [{ claim: 1, supportedBy }] },
});
const overloaded = () =>
  new ProviderError("Gemini", "high demand", { status: 503, retryable: true });

function run(generateStructured: ReturnType<typeof vi.fn>) {
  return checkSupport(
    { gemini: { generateStructured } as unknown as GeminiClient, model: "fast" },
    { body: "It cost 412 million [S1].", passages, retryDelayMs: 0 },
  );
}

describe("checkSupport", () => {
  it("retries a passing failure, so a demand spike doesn't skip the check", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValueOnce(verdict(["S1"]));
    const result = await run(call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(result?.run.status).toBe("succeeded");
    expect(result?.verdicts).toEqual([{ label: "S1", support: "supported" }]);
  });

  it("doesn't retry a spent quota, and reports a check that failed", async () => {
    const call = vi
      .fn()
      .mockRejectedValue(new ProviderError("Gemini", "quota", { status: 429, retryable: true }));
    const result = await run(call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(result?.run.status).toBe("failed");
    expect(result?.verdicts).toEqual([]);
  });

  it("gives up after one retry", async () => {
    const call = vi.fn().mockRejectedValue(overloaded());
    expect((await run(call))?.run.status).toBe("failed");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("flags a citation no passage supports", async () => {
    const result = await run(vi.fn().mockResolvedValue(verdict([])));
    expect(result?.verdicts).toEqual([{ label: "S1", support: "unsupported" }]);
    expect(result?.unsupportedClaims).toBe(1);
  });
});
