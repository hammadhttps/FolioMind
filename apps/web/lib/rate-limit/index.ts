import "server-only";
import type { ActionResult } from "@foliomind/contracts";
import { cacheKey } from "@foliomind/domain";
import { after } from "next/server";
import { appEnv, env } from "@/env";
import { getRequestRedis } from "@/lib/clients";
import { getCurrentUser } from "@/lib/session";
import {
  createRateLimiter,
  ipIdentifier,
  rateLimitMessage,
  rateLimitResponse,
  userIdentifier,
  type RateLimitCheck,
  type RateLimitClassName,
} from "./core";

export { RATE_LIMIT_CLASSES, rateLimitMessage, type RateLimitClassName } from "./core";

/*
 * Rate limits for route handlers and Server Actions (Section 23). Signed-in
 * users are identified by their local user ID, guests by an IP HMAC.
 */

let checker: RateLimitCheck | undefined;

function check(): RateLimitCheck {
  checker ??= createRateLimiter({
    redis: getRequestRedis(),
    keyPrefix: cacheKey(appEnv),
    waitUntil: (promise) => after(() => promise),
  });
  return checker;
}

async function identify(headers: Headers): Promise<string> {
  const user = await getCurrentUser();
  return user ? userIdentifier(user.id) : ipIdentifier(headers, env.RATE_LIMIT_IP_SECRET);
}

/**
 * Wraps a route handler: over the limit it answers 429 with Retry-After and
 * RateLimit-* headers (or 503 for fail-closed classes) before the handler runs.
 */
export function withRateLimit<TContext>(
  name: RateLimitClassName,
  handler: (request: Request, context: TContext) => Promise<Response>,
) {
  return async (request: Request, context: TContext): Promise<Response> => {
    const decision = await check()(name, await identify(request.headers));
    if (!decision.allowed) return rateLimitResponse(decision);
    return handler(request, context);
  };
}

/** For Server Actions: null when allowed, otherwise the typed `rate_limited` result. */
export async function rateLimitAction(
  name: RateLimitClassName,
  headers: Headers,
): Promise<Extract<ActionResult, { ok: false }> | null> {
  const decision = await check()(name, await identify(headers));
  if (decision.allowed) return null;
  if (decision.reason === "unavailable") {
    return {
      ok: false,
      code: "unavailable",
      formError: "This isn't available right now. Please try again shortly.",
    };
  }
  return {
    ok: false,
    code: "rate_limited",
    formError: rateLimitMessage(decision.retryAfterSeconds),
    retryAfterSeconds: decision.retryAfterSeconds,
  };
}
