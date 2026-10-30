import "server-only";
import { createGemini, createJina } from "@foliomind/ai";
import { requireVariables } from "@foliomind/contracts";
import { createDb, type DbConnection } from "@foliomind/db";
import { createPushEngage, createRedis, createStripe } from "@foliomind/domain";
import { createInngest } from "@foliomind/workflows";
import { UTApi } from "uploadthing/server";
import { env } from "@/env";

/*
 * Lazily created, process-wide service clients for server code. Configuration
 * comes from the validated environment (Section 13). Calling a getter for a
 * third-party service whose keys are missing (development only) throws
 * ServiceNotConfiguredError naming the variables to set.
 */

function lazy<T>(create: () => T): () => T {
  let instance: T | undefined;
  return () => (instance ??= create());
}

// The pool survives dev hot reloads instead of opening a new one per reload.
const globalForDb = globalThis as typeof globalThis & { __foliomindDb?: DbConnection };

export function getDb() {
  globalForDb.__foliomindDb ??= createDb({ url: env.DATABASE_URL, role: "web" });
  return globalForDb.__foliomindDb.db;
}

export const getRedis = lazy(() =>
  createRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
);

/** Sends events only; functions run on the workers (Section 9). */
export const getInngest = lazy(() =>
  createInngest({
    appId: "foliomind-web",
    isDev: env.INNGEST_DEV === "1",
    eventKey: env.INNGEST_EVENT_KEY,
    baseUrl: env.INNGEST_BASE_URL,
  }),
);

export const getUtApi = lazy(() => {
  const { UPLOADTHING_TOKEN } = requireVariables(env, "UploadThing", ["UPLOADTHING_TOKEN"]);
  return new UTApi({ token: UPLOADTHING_TOKEN });
});

export const getStripe = lazy(() => {
  const { STRIPE_SECRET_KEY } = requireVariables(env, "Stripe", ["STRIPE_SECRET_KEY"]);
  return createStripe(STRIPE_SECRET_KEY);
});

export const getJina = lazy(() => {
  const { JINA_API_KEY } = requireVariables(env, "Jina", ["JINA_API_KEY"]);
  return createJina({
    apiKey: JINA_API_KEY,
    embeddingModel: env.JINA_EMBEDDING_MODEL,
    embeddingDimension: env.JINA_EMBEDDING_DIMENSION,
    rerankerModel: env.JINA_RERANKER_MODEL,
  });
});

export const getGemini = lazy(() => {
  const { GEMINI_API_KEY } = requireVariables(env, "Gemini", ["GEMINI_API_KEY"]);
  return createGemini({ apiKey: GEMINI_API_KEY });
});

export const getPushEngage = lazy(() => {
  const { PUSHENGAGE_API_KEY } = requireVariables(env, "PushEngage", ["PUSHENGAGE_API_KEY"]);
  return createPushEngage({ apiKey: PUSHENGAGE_API_KEY });
});
