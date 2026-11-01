// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createRedis } from "@foliomind/domain";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createRateLimiter,
  ipIdentifier,
  RATE_LIMIT_CLASSES,
  rateLimitMessage,
  rateLimitResponse,
} from "./core";

/*
 * Runs against the local Upstash-compatible proxy (`pnpm stack:up`) or the CI
 * service container; the Redis-backed cases skip with a message without it.
 */
const UPSTASH = {
  url: process.env.TEST_UPSTASH_REDIS_REST_URL || "http://localhost:8079",
  token: process.env.TEST_UPSTASH_REDIS_REST_TOKEN || "foliomind-local-dev-token",
};

let redisReady = false;
beforeAll(async () => {
  try {
    const response = await fetch(UPSTASH.url, {
      method: "POST",
      headers: { authorization: `Bearer ${UPSTASH.token}`, "content-type": "application/json" },
      body: JSON.stringify(["PING"]),
      signal: AbortSignal.timeout(2000),
    });
    redisReady = response.ok;
  } catch {
    redisReady = false;
  }
  if (!redisReady && process.env.REQUIRE_TEST_SERVICES) {
    throw new Error("[rate-limit tests] The Upstash proxy is not reachable.");
  }
  if (!redisReady)
    console.warn("[rate-limit tests] Upstash proxy not reachable; Redis cases skip.");
});

describe("rate limits against the Upstash proxy", () => {
  it("returns 429 with Retry-After and RateLimit headers once the limit is reached", async (context) => {
    if (!redisReady) return context.skip();
    const check = createRateLimiter({
      redis: createRedis({ ...UPSTASH, retries: 0 }),
      keyPrefix: `fm:test-${randomUUID()}`,
    });
    const user = `user:${randomUUID()}`;
    // accountSecurity allows 5 per hour.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await check("accountSecurity", user)).toEqual({ allowed: true });
    }
    const decision = await check("accountSecurity", user);
    expect(decision).toMatchObject({ allowed: false, reason: "limited", limit: 5 });
    if (decision.allowed || decision.reason !== "limited") return;

    const response = rateLimitResponse(decision);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("ratelimit-limit")).toBe("5");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(Number(response.headers.get("ratelimit-reset"))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });

    // Another identifier is unaffected.
    expect(await check("accountSecurity", `user:${randomUUID()}`)).toEqual({ allowed: true });
  });

  it("applies both chat windows", async (context) => {
    if (!redisReady) return context.skip();
    const check = createRateLimiter({
      redis: createRedis({ ...UPSTASH, retries: 0 }),
      keyPrefix: `fm:test-${randomUUID()}`,
    });
    const user = `user:${randomUUID()}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await check("chat", user)).allowed).toBe(true);
    }
    expect(await check("chat", user)).toMatchObject({
      allowed: false,
      reason: "limited",
      limit: 10,
    });
  });
});

describe("rate limits when Redis is unreachable", () => {
  const check = createRateLimiter({
    redis: createRedis({ url: "http://127.0.0.1:9", token: "unused", retries: 0 }),
    keyPrefix: "fm:test",
    timeoutMs: 1000,
  });

  it.each(
    Object.entries(RATE_LIMIT_CLASSES).filter(([, policy]) => policy.onRedisFailure === "allow"),
  )("fails open for %s", async (name) => {
    expect(await check(name as keyof typeof RATE_LIMIT_CLASSES, "user:x")).toEqual({
      allowed: true,
    });
  });

  it.each(
    Object.entries(RATE_LIMIT_CLASSES).filter(([, policy]) => policy.onRedisFailure === "deny"),
  )("fails closed with 503 for %s", async (name) => {
    const decision = await check(name as keyof typeof RATE_LIMIT_CLASSES, "user:x");
    expect(decision).toEqual({ allowed: false, reason: "unavailable" });
    if (decision.allowed) return;
    expect(rateLimitResponse(decision).status).toBe(503);
  });

  it("marks exactly the Section 23 fail-closed classes", () => {
    const closed = Object.entries(RATE_LIMIT_CLASSES)
      .filter(([, policy]) => policy.onRedisFailure === "deny")
      .map(([name]) => name)
      .sort();
    expect(closed).toEqual([
      "accountSecurity",
      "billingSession",
      "reportOrApplication",
      "urlImport",
    ]);
  });
});

describe("identifiers and copy", () => {
  it("hashes guest IPs and never exposes them", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    const id = ipIdentifier(headers, "a-secret-of-sixteen+");
    expect(id).toMatch(/^ip:[A-Za-z0-9_-]{43}$/);
    expect(id).not.toContain("203.0.113.7");
    expect(ipIdentifier(new Headers({ "x-real-ip": "203.0.113.7" }), "a-secret-of-sixteen+")).toBe(
      id,
    );
    expect(ipIdentifier(headers, "another-secret-value")).not.toBe(id);
  });

  it("uses the Section 23 toast wording", () => {
    expect(rateLimitMessage(20)).toBe("You're going a little fast. Try again in 20 seconds.");
    expect(rateLimitMessage(1)).toBe("You're going a little fast. Try again in 1 second.");
    expect(rateLimitMessage(600)).toBe("You're going a little fast. Try again in 10 minutes.");
  });
});
