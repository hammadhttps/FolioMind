import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { rateLimitMessage } from "./message";

export { rateLimitMessage };

/*
 * Request rate limits (blueprint Section 23). Sliding windows in Upstash with
 * an in-memory cache of already-blocked identifiers, analytics on and a
 * one-second timeout. When Redis is slow or down each route class follows its
 * failure policy: most fail open because Postgres quotas still bound cost;
 * routes with external side effects and no quota fail closed with 503.
 * Limits are provisional values to tune with real traffic.
 */

type Window = `${number} ${"s" | "m" | "h"}`;

export interface RateLimitClass {
  windows: readonly { limit: number; window: Window }[];
  /** What happens when Redis cannot answer within the timeout. */
  onRedisFailure: "allow" | "deny";
}

export const RATE_LIMIT_CLASSES = {
  /** Every request, keyed by IP HMAC, in the proxy. */
  global: { windows: [{ limit: 300, window: "1 m" }], onRedisFailure: "allow" },
  publicCatalog: { windows: [{ limit: 60, window: "1 m" }], onRedisFailure: "allow" },
  authenticatedRead: { windows: [{ limit: 240, window: "1 m" }], onRedisFailure: "allow" },
  authenticatedMutation: { windows: [{ limit: 60, window: "1 m" }], onRedisFailure: "allow" },
  chat: {
    windows: [
      { limit: 10, window: "1 m" },
      { limit: 100, window: "1 h" },
    ],
    onRedisFailure: "allow",
  },
  upload: { windows: [{ limit: 10, window: "10 m" }], onRedisFailure: "allow" },
  urlImport: { windows: [{ limit: 5, window: "10 m" }], onRedisFailure: "deny" },
  generation: { windows: [{ limit: 10, window: "10 m" }], onRedisFailure: "allow" },
  billingSession: { windows: [{ limit: 5, window: "10 m" }], onRedisFailure: "deny" },
  reportOrApplication: { windows: [{ limit: 5, window: "1 h" }], onRedisFailure: "deny" },
  /** Sign-in method link/unlink and account deletion. */
  accountSecurity: { windows: [{ limit: 5, window: "1 h" }], onRedisFailure: "deny" },
  adminMutation: { windows: [{ limit: 60, window: "1 m" }], onRedisFailure: "allow" },
} as const satisfies Record<string, RateLimitClass>;

export type RateLimitClassName = keyof typeof RATE_LIMIT_CLASSES;

export type RateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "limited";
      limit: number;
      /** Unix time in milliseconds when the window frees up. */
      reset: number;
      retryAfterSeconds: number;
    }
  | { allowed: false; reason: "unavailable" };

export interface RateLimiterOptions {
  redis: Redis;
  /** `fm:{env}` (Section 23 key prefix). */
  keyPrefix: string;
  timeoutMs?: number;
  /** Keeps background work (analytics writes) alive after the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
  now?: () => number;
}

export function createRateLimiter({
  redis,
  keyPrefix,
  timeoutMs = 1000,
  waitUntil,
  now = Date.now,
}: RateLimiterOptions) {
  const limiters = new Map<string, Ratelimit>();

  function limiterFor(name: RateLimitClassName, index: number): Ratelimit {
    const id = `${name}:${index}`;
    let limiter = limiters.get(id);
    if (!limiter) {
      const { limit, window } = RATE_LIMIT_CLASSES[name].windows[index]!;
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, window),
        prefix: `${keyPrefix}:rl:${name}:${window.replace(" ", "")}`,
        ephemeralCache: new Map(),
        analytics: true,
        timeout: timeoutMs,
      });
      limiters.set(id, limiter);
    }
    return limiter;
  }

  return async function check(
    name: RateLimitClassName,
    identifier: string,
    request: { waitUntil?: (promise: Promise<unknown>) => void } = {},
  ): Promise<RateLimitDecision> {
    const keepAlive = request.waitUntil ?? waitUntil;
    const policy = RATE_LIMIT_CLASSES[name];
    for (let index = 0; index < policy.windows.length; index += 1) {
      let result: Awaited<ReturnType<Ratelimit["limit"]>>;
      try {
        result = await limiterFor(name, index).limit(identifier);
      } catch {
        return policy.onRedisFailure === "allow"
          ? { allowed: true }
          : { allowed: false, reason: "unavailable" };
      }
      if (result.reason === "timeout") {
        return policy.onRedisFailure === "allow"
          ? { allowed: true }
          : { allowed: false, reason: "unavailable" };
      }
      keepAlive?.(result.pending.catch(() => {}));
      if (!result.success) {
        return {
          allowed: false,
          reason: "limited",
          limit: result.limit,
          reset: result.reset,
          retryAfterSeconds: Math.max(1, Math.ceil((result.reset - now()) / 1000)),
        };
      }
    }
    return { allowed: true };
  };
}

export type RateLimitCheck = ReturnType<typeof createRateLimiter>;

/** Guests are identified by an HMAC of their IP; raw IPs are never stored. */
export function ipIdentifier(headers: Headers, secret: string): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = headers.get("x-real-ip")?.trim() || forwarded || "unknown";
  return `ip:${createHmac("sha256", secret).update(ip).digest("base64url")}`;
}

export const userIdentifier = (userId: string) => `user:${userId}`;

/** HTTP 429 with Retry-After and the RateLimit-* headers, or 503 for fail-closed classes. */
export function rateLimitResponse(
  decision: Exclude<RateLimitDecision, { allowed: true }>,
): Response {
  if (decision.reason === "unavailable") {
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "This isn't available right now. Please try again shortly.",
        },
      },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  return Response.json(
    {
      error: {
        code: "rate_limited",
        message: rateLimitMessage(decision.retryAfterSeconds),
        retryAfterSeconds: decision.retryAfterSeconds,
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
        "RateLimit-Limit": String(decision.limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(decision.retryAfterSeconds),
      },
    },
  );
}
