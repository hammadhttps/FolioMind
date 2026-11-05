import { CACHE_TTL_SECONDS, readCache, writeCache, type CacheKeys } from "@foliomind/domain";
import type { Redis } from "@upstash/redis";
import { z } from "zod";
import type { JinaClient } from "../jina";

/*
 * Query embeddings (Sections 8 and 23): the same model and dimension as the
 * index, with the query task, cached for a day under a key scoped to the user.
 * Redis trouble only means a fresh embedding.
 */

export interface EmbedQueryDeps {
  jina: JinaClient;
  redis: Redis | null;
  cacheKeys: CacheKeys;
  embeddingModel: string;
  embeddingDimension: number;
}

export const normalizeQuery = (text: string): string =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

export async function embedQuery(
  deps: EmbedQueryDeps,
  userId: string,
  query: string,
): Promise<{ embedding: number[]; cached: boolean; tokens: number }> {
  const schema = z.array(z.number()).length(deps.embeddingDimension);
  const key = deps.cacheKeys.queryEmbedding(
    deps.embeddingModel,
    deps.embeddingDimension,
    userId,
    normalizeQuery(query),
  );
  const hit = await readCache(deps.redis, key, schema);
  if (hit) return { embedding: hit, cached: true, tokens: 0 };
  const result = await deps.jina.embed([query], { task: "retrieval.query" });
  const embedding = result.embeddings[0];
  if (!embedding) throw new Error("Jina returned no embedding for the query");
  await writeCache(deps.redis, key, embedding, CACHE_TTL_SECONDS.queryEmbedding);
  return { embedding, cached: false, tokens: result.usage.totalTokens };
}
