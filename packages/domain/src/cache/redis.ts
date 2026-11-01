import { Redis } from "@upstash/redis";
import type { AppEnv } from "@foliomind/contracts";

export interface RedisConfig {
  url: string;
  token: string;
  /**
   * Retries for failed requests. Callers on a request's critical path (rate
   * limits, caches) pass 0 so an unreachable Redis costs one attempt, not three.
   */
  retries?: number;
}

/** The Compose REST proxy in front of open-source Redis (local development and CI). */
const LOCAL_PROXY_HOSTS = new Set(["localhost", "127.0.0.1", "upstash-http"]);

/**
 * `@upstash/ratelimit` scripts start with `#!lua flags=allow-key-locking`, a
 * flag only Upstash's own Redis accepts; open-source Redis 7 and 8 reject the
 * whole script. Against the local proxy the flag line is dropped, so the same
 * limiter code runs offline and in CI. Upstash cloud receives scripts unchanged.
 */
const UPSTASH_SCRIPT_FLAGS = /^#!lua flags=[^\n]*\n/;

function isLocalProxy(url: string): boolean {
  try {
    return LOCAL_PROXY_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Upstash Redis over HTTPS (blueprint Section 23). Works against Upstash cloud
 * and the local Compose REST proxy. Holds rate-limit counters and rebuildable
 * caches only; Postgres stays the source of truth.
 */
export function createRedis({ url, token, retries = 2 }: RedisConfig): Redis {
  const redis = new Redis({
    url,
    token,
    enableTelemetry: false,
    retry:
      retries > 0 ? { retries, backoff: (attempt) => Math.min(1000, 100 * 2 ** attempt) } : false,
  });
  if (!isLocalProxy(url)) return redis;
  // The client is itself an auto-pipelining Proxy, so wrap it rather than assign.
  const localEval = ((script: string, keys: string[], args: unknown[]) =>
    redis.eval(script.replace(UPSTASH_SCRIPT_FLAGS, ""), keys, args)) as Redis["eval"];
  return new Proxy(redis, {
    get: (target, property, receiver) =>
      property === "eval" ? localEval : Reflect.get(target, property, receiver),
  });
}

/** Every key is namespaced `fm:{env}:` (Section 23). */
export function cacheKey(appEnv: AppEnv, ...parts: readonly (string | number)[]): string {
  return ["fm", appEnv, ...parts].join(":");
}
