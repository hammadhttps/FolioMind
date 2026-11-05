import { ProviderError } from "@foliomind/contracts";
import { describe, expect, it } from "vitest";
import { isDailyQuotaError, retryAfterFrom } from "./gemini";

/** The shape the SDK passes along for a 429: JSON inside a JSON string. */
const quotaMessage = (delay: string) =>
  JSON.stringify({
    error: {
      message: JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
            },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay },
          ],
        },
      }),
    },
  });

describe("retryAfterFrom", () => {
  it("reads the wait from an escaped quota error", () => {
    expect(retryAfterFrom(quotaMessage("38177s"))).toBe(38_177_000);
    expect(retryAfterFrom(quotaMessage("12.5s"))).toBe(12_500);
  });

  it("is undefined when the message names no wait", () => {
    expect(retryAfterFrom("fetch failed")).toBeUndefined();
  });
});

describe("isDailyQuotaError", () => {
  const error = (status: number, retryAfterMs?: number) =>
    new ProviderError("Gemini", "quota", {
      status,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });

  it("tells a day's limit from a minute's", () => {
    expect(isDailyQuotaError(error(429, 38_177_000))).toBe(true);
    expect(isDailyQuotaError(error(429, 40_000))).toBe(false);
    expect(isDailyQuotaError(error(429))).toBe(false);
    expect(isDailyQuotaError(error(503, 38_177_000))).toBe(false);
    expect(isDailyQuotaError(new Error("quota"))).toBe(false);
  });
});
