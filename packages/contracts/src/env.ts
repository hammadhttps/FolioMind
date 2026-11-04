import { z } from "zod";
import { ServiceNotConfiguredError } from "./errors";
import { INDEX_EMBEDDING_DIMENSION } from "./indexing";

/*
 * Environment variable shapes shared by the web app, both workers and scripts
 * (blueprint Section 13). Local infrastructure variables are always required;
 * their .env.example defaults point at the Docker Compose stack. Third-party
 * service variables are optional while APP_ENV is "development" or "test" and
 * required in "staging" and "production".
 */

const secret = z.string().min(1);

export const appEnvSchema = z.enum(["development", "test", "staging", "production"]);
export type AppEnv = z.infer<typeof appEnvSchema>;

/** APP_ENV wins; otherwise Vercel production/preview map to production/staging. */
export function resolveAppEnv(source: Record<string, string | undefined>): AppEnv {
  const explicit = appEnvSchema.safeParse(source.APP_ENV);
  if (explicit.success) return explicit.data;
  if (source.VERCEL_ENV === "production") return "production";
  if (source.VERCEL_ENV === "preview") return "staging";
  return "development";
}

export function requiresServices(appEnv: AppEnv): boolean {
  return appEnv === "staging" || appEnv === "production";
}

export const logLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  .default("info");

export const baseShape = {
  APP_ENV: appEnvSchema.optional(),
  LOG_LEVEL: logLevelSchema,
};

export const databaseShape = {
  /** Pooled connection for short web requests. */
  DATABASE_URL: z.url(),
};

export const directDatabaseShape = {
  /** Direct connection for workers and migrations. */
  DIRECT_DATABASE_URL: z.url(),
};

export const upstashShape = {
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: secret,
};

export const rateLimitShape = {
  /** HMAC key for hashing guest IPs into rate-limit identifiers (Section 23). */
  RATE_LIMIT_IP_SECRET: z.string().min(16),
};

export const inngestShape = {
  /** "1" points the SDK at the local Inngest Dev Server. Never set in staging or production. */
  INNGEST_DEV: z.enum(["0", "1"]).optional(),
  INNGEST_BASE_URL: z.url().optional(),
  INNGEST_EVENT_KEY: secret.optional(),
};

export const inngestWorkerShape = {
  ...inngestShape,
  INNGEST_SIGNING_KEY: secret.optional(),
  /** Stable Connect instance ID; defaults to the hostname. */
  WORKER_INSTANCE_ID: z.string().min(1).optional(),
};

export const auth0Shape = {
  /** Tenant or custom domain, e.g. foliomind-dev.us.auth0.com (a leading https:// is stripped). */
  AUTH0_DOMAIN: z
    .string()
    .transform((value) => value.replace(/^https?:\/\//i, "").replace(/\/+$/, ""))
    .pipe(z.string().regex(/^[a-z0-9.-]+$/i, "a hostname"))
    .optional(),
  AUTH0_CLIENT_ID: secret.optional(),
  AUTH0_CLIENT_SECRET: secret.optional(),
  /** Session encryption secret; generate with `openssl rand -hex 32`. */
  AUTH0_SECRET: z.string().min(32, "at least 32 characters").optional(),
  APP_BASE_URL: z.url().optional(),
  AUTH0_MGMT_CLIENT_ID: secret.optional(),
  AUTH0_MGMT_CLIENT_SECRET: secret.optional(),
};

export const uploadthingShape = {
  UPLOADTHING_TOKEN: secret.optional(),
};

export const browserlessShape = {
  BROWSERLESS_WS_ENDPOINT: z.url(),
  BROWSERLESS_TOKEN: secret,
};

export const jinaShape = {
  JINA_API_KEY: secret.optional(),
  JINA_EMBEDDING_MODEL: z.string().min(1).default("jina-embeddings-v5-text-small"),
  /** Must equal the `document_chunks.embedding` column size; changing it needs a migration. */
  JINA_EMBEDDING_DIMENSION: z.coerce
    .number()
    .int()
    .refine((value) => value === INDEX_EMBEDDING_DIMENSION, {
      message: `must be ${INDEX_EMBEDDING_DIMENSION} (the indexed embedding size)`,
    })
    .default(INDEX_EMBEDDING_DIMENSION),
  JINA_RERANKER_MODEL: z.string().min(1).default("jina-reranker-v3.5"),
};

export const geminiShape = {
  GEMINI_API_KEY: secret.optional(),
  GEMINI_CHAT_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  GEMINI_GENERATION_MODEL: z.string().min(1).default("gemini-3.6-flash"),
};

export const stripeSecretShape = {
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_(test|live)_/, "a Stripe secret or restricted key")
    .optional(),
};

export const stripeWebShape = {
  ...stripeSecretShape,
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  /** Created in Phase 10. */
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().startsWith("price_").optional(),
};

/**
 * Variables each deployable needs once APP_ENV is staging or production.
 * STRIPE_WEBHOOK_SECRET joins the web list in Phase 10 with the webhook route.
 */
export const PRODUCTION_REQUIRED = {
  web: [
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "AUTH0_MGMT_CLIENT_ID",
    "AUTH0_MGMT_CLIENT_SECRET",
    "UPLOADTHING_TOKEN",
    "INNGEST_EVENT_KEY",
    "JINA_API_KEY",
    "GEMINI_API_KEY",
    "STRIPE_SECRET_KEY",
  ],
  // STRIPE_SECRET_KEY joins in Phase 10 with sync-stripe and reconcile-billing.
  workerIngestion: [
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
    "UPLOADTHING_TOKEN",
    "JINA_API_KEY",
  ],
  workerGeneration: [
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
    "UPLOADTHING_TOKEN",
    "JINA_API_KEY",
    "GEMINI_API_KEY",
  ],
} as const;

/**
 * Names Vercel Marketplace integrations inject, keyed by the FolioMind name
 * they stand in for. The FolioMind name wins when both are set.
 */
export const ENV_ALIASES = {
  UPSTASH_REDIS_REST_URL: "KV_REST_API_URL",
  UPSTASH_REDIS_REST_TOKEN: "KV_REST_API_TOKEN",
  AUTH0_MGMT_CLIENT_ID: "AUTH0_MANAGEMENT_API_CLIENT_ID",
  AUTH0_MGMT_CLIENT_SECRET: "AUTH0_MANAGEMENT_API_CLIENT_SECRET",
} as const;

/** FolioMind variables that are unset in `source` but provided under an alias. */
export function aliasedVariables(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const filled: Record<string, string> = {};
  for (const [name, alias] of Object.entries(ENV_ALIASES)) {
    const value = source[alias];
    if (!source[name] && value) filled[name] = value;
  }
  return filled;
}

/** Names of required variables that are unset, plus deployment rules for staging/production. */
export function productionProblems(
  env: Record<string, unknown>,
  required: readonly string[],
): string[] {
  const problems = required.filter((name) => env[name] === undefined || env[name] === "");
  if (env.INNGEST_DEV === "1") problems.push("INNGEST_DEV (must be unset outside development)");
  return problems;
}

/** Turns validation issues into variable names only — values are never included. */
export function variableNamesFromIssues(
  issues: readonly { path?: readonly (PropertyKey | { key: PropertyKey })[] | undefined }[],
): string[] {
  const names = issues.map((issue) => {
    const first = issue.path?.[0];
    const key = typeof first === "object" && first !== null ? first.key : first;
    return key === undefined ? "(unknown variable)" : String(key);
  });
  return [...new Set(names)].sort();
}

export class EnvValidationError extends Error {
  readonly variables: readonly string[];

  constructor(app: string, variables: readonly string[], reason: string) {
    super(`${app}: ${reason}: ${variables.join(", ")}`);
    this.name = "EnvValidationError";
    this.variables = variables;
  }
}

/**
 * Parses an environment object for an app. Throws EnvValidationError listing
 * variable names only, so logs never contain secret values.
 */
export function parseEnv<TSchema extends z.ZodType<Record<string, unknown>>>(
  app: string,
  schema: TSchema,
  source: Record<string, string | undefined>,
  requiredInProduction: readonly string[],
): z.infer<TSchema> & { appEnv: AppEnv } {
  const cleaned = Object.fromEntries(
    Object.entries({ ...source, ...aliasedVariables(source) }).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvValidationError(
      app,
      variableNamesFromIssues(parsed.error.issues),
      "invalid or missing environment variables",
    );
  }
  const appEnv = resolveAppEnv(source);
  if (requiresServices(appEnv)) {
    const problems = productionProblems(parsed.data, requiredInProduction);
    if (problems.length > 0) {
      throw new EnvValidationError(app, problems, `missing variables required in ${appEnv}`);
    }
  }
  return { ...parsed.data, appEnv };
}

/**
 * Picks the variables a service needs, throwing ServiceNotConfiguredError when
 * any are missing (possible only in development, where they are optional).
 */
export function requireVariables<TEnv extends object, TKey extends keyof TEnv & string>(
  env: TEnv,
  service: string,
  keys: readonly TKey[],
): { [K in TKey]-?: NonNullable<TEnv[K]> } {
  const missing = keys.filter((key) => env[key] === undefined || env[key] === "");
  if (missing.length > 0) throw new ServiceNotConfiguredError(service, missing);
  return Object.fromEntries(keys.map((key) => [key, env[key]])) as {
    [K in TKey]-?: NonNullable<TEnv[K]>;
  };
}

/**
 * Server-side address of a stored file on the UploadThing app named by the
 * token (`https://<appId>.ufs.sh/f/<key>`). Never sent to a browser: reads go
 * through FolioMind's authorized routes or the workers.
 */
export function uploadThingFileUrl(token: string, fileKey: string): string {
  let appId: unknown;
  try {
    appId = (JSON.parse(atob(token.trim())) as { appId?: unknown }).appId;
  } catch {
    appId = undefined;
  }
  if (typeof appId !== "string" || !/^[a-z0-9]+$/i.test(appId)) {
    throw new Error("UPLOADTHING_TOKEN is not a valid v7 token (no app ID)");
  }
  return `https://${appId}.ufs.sh/f/${encodeURIComponent(fileKey)}`;
}
