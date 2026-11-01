import "server-only";
import { createHmac } from "node:crypto";
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { headers } from "next/headers";
import { appEnv, env } from "@/env";
import { getRedis } from "./clients";

/*
 * Upstash sliding-window limits (blueprint Section 23). Identifiers are HMACs,
 * so raw IPs and email addresses never reach Redis. Phase 4 adds the remaining
 * route classes and the global proxy guard on top of these helpers.
 */

export type LimitResult =
  { ok: true } | { ok: false; retryAfterSeconds: number; unavailable?: boolean };

const limiters = new Map<string, Ratelimit>();

function limiter(name: string, tokens: number, window: Duration): Ratelimit {
  let instance = limiters.get(name);
  if (!instance) {
    instance = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `fm:${appEnv}:rl:${name}`,
      ephemeralCache: new Map(),
      analytics: true,
      timeout: 1000,
    });
    limiters.set(name, instance);
  }
  return instance;
}

export function hmacIdentifier(value: string): string {
  return createHmac("sha256", env.RATE_LIMIT_IP_SECRET)
    .update(value)
    .digest("base64url")
    .slice(0, 32);
}

/** Client IP from the platform's forwarding header (Vercel sets x-forwarded-for). */
export async function clientIpIdentifier(): Promise<string> {
  const list = await headers();
  const ip =
    list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
  return `ip:${hmacIdentifier(ip)}`;
}

/**
 * Checks every rule and passes only if all pass. Fails closed: if Redis is slow
 * or down, the request is refused, because these routes send email without a
 * quota behind them (Section 23 failure policy).
 */
export async function checkLimits(
  rules: { name: string; identifier: string; tokens: number; window: Duration }[],
): Promise<LimitResult> {
  try {
    const results = await Promise.all(
      rules.map((rule) => limiter(rule.name, rule.tokens, rule.window).limit(rule.identifier)),
    );
    if (results.some((result) => result.reason === "timeout")) {
      return { ok: false, retryAfterSeconds: 30, unavailable: true };
    }
    const blocked = results.filter((result) => !result.success);
    if (blocked.length === 0) return { ok: true };
    const reset = Math.max(...blocked.map((result) => result.reset));
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  } catch {
    return { ok: false, retryAfterSeconds: 30, unavailable: true };
  }
}
