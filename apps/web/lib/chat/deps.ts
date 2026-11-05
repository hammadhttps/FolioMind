import "server-only";
import type { ChatDeps } from "@foliomind/ai/chat";
import { env } from "@/env";
import { getCacheKeys, getDb, getGemini, getJina, getRequestRedis } from "@/lib/clients";

/** Structured console JSON for the web app: IDs, codes and timings only. */
function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ source: "chat", event, ...fields }));
}

export function getChatDeps(): ChatDeps {
  return {
    db: getDb(),
    jina: getJina(),
    gemini: getGemini(),
    redis: getRequestRedis(),
    cacheKeys: getCacheKeys(),
    models: {
      answer: env.GEMINI_CHAT_MODEL,
      fast: env.GEMINI_FAST_MODEL,
      embedding: env.JINA_EMBEDDING_MODEL,
      embeddingDimension: env.JINA_EMBEDDING_DIMENSION,
    },
    log,
  };
}
