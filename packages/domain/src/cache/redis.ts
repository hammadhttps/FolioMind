import { Redis } from "@upstash/redis";
import type { AppEnv } from "@foliomind/contracts";

export interface RedisConfig {
  url: string;
  token: string;
}

/**
 * Upstash Redis over HTTPS (blueprint Section 23). Works against Upstash cloud
 * and the local Compose REST proxy. Holds rate-limit counters and rebuildable
 * caches only; Postgres stays the source of truth.
 */
export function createRedis({ url, token }: RedisConfig): Redis {
  return new Redis({
    url,
    token,
    enableTelemetry: false,
    retry: { retries: 2, backoff: (attempt) => Math.min(1000, 100 * 2 ** attempt) },
  });
}

/** Every key is namespaced `fm:{env}:` (Section 23). */
export function cacheKey(appEnv: AppEnv, ...parts: readonly (string | number)[]): string {
  return ["fm", appEnv, ...parts].join(":");
}
