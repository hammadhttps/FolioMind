import { randomUUID } from "node:crypto";
import { describe, expect, inject, it, vi } from "vitest";
import { z } from "zod";
import { TEST_REDIS } from "../test/env";
import {
  bumpCatalogVersion,
  cached,
  cacheKeys,
  catalogVersion,
  createRedis,
  invalidateUserSnapshot,
  readCache,
  writeCache,
} from ".";

const redis = createRedis({ url: TEST_REDIS.url, token: TEST_REDIS.token, retries: 0 });
const keys = cacheKeys("test");
const schema = z.object({ name: z.string() });

describe("cache key builders", () => {
  it("prefix every key with fm:{env}: and hash user-supplied parts", () => {
    expect(keys.userSnapshot("u1")).toBe("fm:test:user:u1:snapshot");
    expect(keys.catalogFacets(3)).toBe("fm:test:catalog:v3:facets");
    expect(keys.catalogResults(2, "q=rivers")).toMatch(/^fm:test:catalog:v2:[0-9a-f]{64}$/);
    expect(keys.queryEmbedding("jina", 1024, "u1", "rivers")).toMatch(
      /^fm:test:emb:jina:1024:[0-9a-f]{64}$/,
    );
    expect(keys.usageSummary("u1", new Date("2026-11-01T00:00:00Z"))).toBe(
      "fm:test:usage:u1:2026-11-01T00:00:00.000Z",
    );
  });
});

describe.skipIf(!inject("redisReady"))("cache against the Upstash proxy", () => {
  it("reads through, then serves the cached value", async () => {
    const key = keys.userSnapshot(randomUUID());
    const load = vi.fn().mockResolvedValue({ name: "Ada" });
    expect(await cached(redis, { key, ttlSeconds: 60, schema, load })).toEqual({ name: "Ada" });
    expect(await cached(redis, { key, ttlSeconds: 60, schema, load })).toEqual({ name: "Ada" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await redis.ttl(key)).toBeGreaterThan(0);

    await invalidateUserSnapshot(redis, keys, key.split(":")[3]!);
    expect(await readCache(redis, key, schema)).toBeUndefined();
  });

  it("treats a value that fails its schema as a miss", async () => {
    const key = keys.userSnapshot(randomUUID());
    await writeCache(redis, key, { name: 42 }, 60);
    const load = vi.fn().mockResolvedValue({ name: "Fresh" });
    expect(await cached(redis, { key, ttlSeconds: 60, schema, load })).toEqual({ name: "Fresh" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("orphans catalog entries when the version counter is bumped", async () => {
    const isolated = cacheKeys("test");
    await redis.del(isolated.catalogVersion());
    expect(await catalogVersion(redis, isolated)).toBe(1);
    await bumpCatalogVersion(redis, isolated);
    expect(await catalogVersion(redis, isolated)).toBe(2);
    expect(await redis.ttl(isolated.catalogVersion())).toBeGreaterThan(0);
  });
});

describe("cache with Redis unavailable", () => {
  const down = createRedis({ url: "http://127.0.0.1:9", token: "unused", retries: 0 });

  it("loads uncached instead of failing", async () => {
    const load = vi.fn().mockResolvedValue({ name: "Direct" });
    const key = keys.userSnapshot(randomUUID());
    expect(await cached(down, { key, ttlSeconds: 60, schema, load })).toEqual({ name: "Direct" });
    expect(await catalogVersion(down, keys)).toBe(1);
  });
});
