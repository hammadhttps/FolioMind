import { describe, expect, it } from "vitest";
import { isRetryableStatus, parseRetryAfter, providerErrorFromResponse } from "./errors";

describe("isRetryableStatus", () => {
  it("retries timeouts, rate limits and server errors only", () => {
    expect([408, 429, 500, 503].map(isRetryableStatus)).toEqual([true, true, true, true]);
    expect([400, 401, 403, 404, 422].map(isRetryableStatus)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    const inFiveSeconds = new Date(Date.now() + 5_000).toUTCString();
    expect(parseRetryAfter(inFiveSeconds)).toBeGreaterThan(3_000);
  });
});

describe("providerErrorFromResponse", () => {
  it("classifies a 429 as retryable and keeps Retry-After", async () => {
    const error = await providerErrorFromResponse(
      "Jina",
      new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
    );
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(2000);
  });

  it("classifies a 401 as permanent", async () => {
    const error = await providerErrorFromResponse("Jina", new Response("bad key", { status: 401 }));
    expect(error.retryable).toBe(false);
  });
});
