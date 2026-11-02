import "server-only";
import { createGemini, createJina } from "@foliomind/ai";
import { requireVariables } from "@foliomind/contracts";
import { createDb, type DbConnection } from "@foliomind/db";
import { cacheKeys, createPushEngage, createRedis, createStripe } from "@foliomind/domain";
import { createInngest } from "@foliomind/workflows";
import { ManagementClient } from "auth0";
import { UTApi } from "uploadthing/server";
import { appEnv, env } from "@/env";

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

/**
 * For the request path (rate limits and caches): no retries, so an unreachable
 * Redis costs one failed attempt before the Section 23 failure policy applies.
 */
export const getRequestRedis = lazy(() =>
  createRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, retries: 0 }),
);

/** Section 23 cache keys for this environment (`fm:{env}:`). */
export const getCacheKeys = lazy(() => cacheKeys(appEnv));

/** Sends events only; functions run on the workers (Section 9). */
export const getInngest = lazy(() =>
  createInngest({
    appId: "foliomind-web",
    isDev: env.INNGEST_DEV === "1",
    eventKey: env.INNGEST_EVENT_KEY,
    baseUrl: env.INNGEST_BASE_URL,
  }),
);

/**
 * Auth0 Management API (Section 22 rule 8): the separate Machine-to-Machine
 * application, used only on the server for linking, unlinking and deleting.
 */
export const getAuth0Management = lazy(() => {
  const { AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET } = requireVariables(
    env,
    "Auth0 Management API",
    ["AUTH0_DOMAIN", "AUTH0_MGMT_CLIENT_ID", "AUTH0_MGMT_CLIENT_SECRET"],
  );
  return new ManagementClient({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_MGMT_CLIENT_ID,
    clientSecret: AUTH0_MGMT_CLIENT_SECRET,
    telemetry: false,
  });
});

/**
 * Server-side URL of a stored file on the app's UploadThing domain. It is
 * never sent to a browser: reads go through FolioMind's authorized routes.
 */
export const storageFileUrl = (() => {
  let appId: string | undefined;
  return (fileKey: string): string => {
    if (!appId) {
      const { UPLOADTHING_TOKEN } = requireVariables(env, "UploadThing", ["UPLOADTHING_TOKEN"]);
      const decoded = JSON.parse(Buffer.from(UPLOADTHING_TOKEN, "base64").toString("utf8")) as {
        appId?: unknown;
      };
      if (typeof decoded.appId !== "string") throw new Error("UPLOADTHING_TOKEN has no app ID");
      appId = decoded.appId;
    }
    return `https://${appId}.ufs.sh/f/${encodeURIComponent(fileKey)}`;
  };
})();

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
