import { createHash } from "node:crypto";
import type { AppEnv } from "@foliomind/contracts";
import type { Redis } from "@upstash/redis";
import type { z } from "zod";
import { cacheKey } from "./redis";

export * from "./redis";

/*
 * Application caches shared by web and workers (blueprint Section 23). Values
 * are rebuildable: every entry has a TTL, carries a schema version and is parsed
 * with Zod on read, and any Redis failure or parse failure counts as a miss.
 * Never cache private document text, chunks, signed URLs, Stripe objects or AI
 * answers across users.
 */

/** Bump when a cached shape changes; old entries then read as misses. */
export const CACHE_SCHEMA_VERSION = 1;

export const CACHE_TTL_SECONDS = {
  catalogResults: 10 * 60,
  catalogFacets: 60 * 60,
  queryEmbedding: 24 * 60 * 60,
  userSnapshot: 60,
  usageSummary: 60,
  publicCounter: 5 * 60,
  /** The catalog version counter outlives every entry keyed by it. */
  catalogVersion: 30 * 24 * 60 * 60,
} as const;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Key builders for the Section 23 cache table. */
export function cacheKeys(appEnv: AppEnv) {
  return {
    catalogVersion: () => cacheKey(appEnv, "catalog", "version"),
    catalogResults: (version: number, normalizedParams: string) =>
      cacheKey(appEnv, "catalog", `v${version}`, sha256(normalizedParams)),
    catalogFacets: (version: number) => cacheKey(appEnv, "catalog", `v${version}`, "facets"),
    queryEmbedding: (model: string, dimension: number, userId: string, normalizedQuery: string) =>
      cacheKey(appEnv, "emb", model, dimension, sha256(userId + normalizedQuery)),
    userSnapshot: (userId: string) => cacheKey(appEnv, "user", userId, "snapshot"),
    usageSummary: (userId: string, periodStart: Date) =>
      cacheKey(appEnv, "usage", userId, periodStart.toISOString()),
    publicCounter: (kind: string, id: string) => cacheKey(appEnv, "count", kind, id),
    /** Daily read and save dedupe for `analytics_daily` (SET NX, two-day TTL). */
    analyticsOnce: (kind: "read" | "save", bookId: string, userId: string, date: string) =>
      cacheKey(appEnv, "analytics", kind, bookId, userId, date),
  };
}

export type CacheKeys = ReturnType<typeof cacheKeys>;

interface Envelope {
  v: number;
  data: unknown;
}

function unwrap<T>(raw: unknown, schema: z.ZodType<T>): T | undefined {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const envelope = value as Partial<Envelope>;
  if (envelope.v !== CACHE_SCHEMA_VERSION) return undefined;
  const parsed = schema.safeParse(envelope.data);
  return parsed.success ? parsed.data : undefined;
}

/** Reads a cached value; undefined on a miss, a stale shape or a Redis failure. */
export async function readCache<T>(
  redis: Redis | null,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  if (!redis) return undefined;
  try {
    return unwrap(await redis.get(key), schema);
  } catch {
    return undefined;
  }
}

/** Best effort: a failed write leaves the next read uncached, never an error. */
export async function writeCache(
  redis: Redis | null,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return;
  try {
    const envelope: Envelope = { v: CACHE_SCHEMA_VERSION, data: value };
    await redis.set(key, JSON.stringify(envelope), { ex: ttlSeconds });
  } catch {
    // Uncached is acceptable (Section 23: Redis outages degrade, never fail).
  }
}

/**
 * Read-through cache. `null` from the loader is not cached, so a missing row
 * is looked up again next time instead of being remembered as absent.
 */
export async function cached<T>(
  redis: Redis | null,
  options: { key: string; ttlSeconds: number; schema: z.ZodType<T>; load: () => Promise<T | null> },
): Promise<T | null> {
  const hit = await readCache(redis, options.key, options.schema);
  if (hit !== undefined) return hit;
  const value = await options.load();
  if (value !== null) await writeCache(redis, options.key, value, options.ttlSeconds);
  return value;
}

export async function deleteCache(redis: Redis | null, ...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // The 60-second TTL bounds staleness; suspension also re-reads Postgres.
  }
}

/** Current catalog cache version (1 when unset or Redis is down). */
export async function catalogVersion(redis: Redis | null, keys: CacheKeys): Promise<number> {
  if (!redis) return 1;
  try {
    const value = Number(await redis.get(keys.catalogVersion()));
    return Number.isInteger(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

/** Approve, unpublish and takedown bump the version, orphaning every catalog entry. */
export async function bumpCatalogVersion(redis: Redis | null, keys: CacheKeys): Promise<void> {
  if (!redis) return;
  try {
    const key = keys.catalogVersion();
    const next = await redis.incr(key);
    // A fresh counter starts at 1, which equals the default; skip ahead so old entries miss.
    if (next === 1) await redis.incr(key);
    await redis.expire(key, CACHE_TTL_SECONDS.catalogVersion);
  } catch {
    // Catalog entries still expire within 10 minutes.
  }
}

/** Role, status or entitlement changed: drop the snapshot so the next request re-reads. */
export function invalidateUserSnapshot(redis: Redis | null, keys: CacheKeys, userId: string) {
  return deleteCache(redis, keys.userSnapshot(userId));
}

/** A reservation committed or released: drop the cached usage summary. */
export function invalidateUsageSummary(
  redis: Redis | null,
  keys: CacheKeys,
  ref: { userId: string; periodStart: Date },
) {
  return deleteCache(redis, keys.usageSummary(ref.userId, ref.periodStart));
}
