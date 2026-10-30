/**
 * `pnpm check:services` — connectivity smoke checks for every FolioMind service
 * (Phase 2, blueprint Section 13). Reads apps/web/.env.local and the worker .env
 * files (process.env wins), runs the checks in parallel with timeouts, and prints
 * a table. Secret values are never printed.
 *
 *   pnpm check:services                      all services
 *   pnpm check:services --only=postgres,upstash,browserless
 *
 * Exit code 1 when a configured service fails.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv as parseDotenv } from "node:util";
import { createGemini, createJina } from "@foliomind/ai";
import { aliasedVariables, resolveAppEnv } from "@foliomind/contracts";
import { createDb } from "@foliomind/db";
import {
  cacheKey,
  createPushEngage,
  createRedis,
  createStripe,
  isStripeTestKey,
} from "@foliomind/domain";
import { renderHtmlToPdf } from "@foliomind/pdf";
import { createInngest, systemPingRequested } from "@foliomind/workflows";
import { UTApi } from "uploadthing/server";
import { z } from "zod";

type Env = Record<string, string | undefined>;
type Status = "pass" | "fail" | "not configured" | "skipped";

interface Check {
  id: string;
  service: string;
  /** All listed variables must be set for the service to count as configured. */
  requires: (env: Env) => string[];
  timeoutMs: number;
  run: (env: Env) => Promise<string>;
}

const root = path.resolve(import.meta.dirname, "..");

function readEnvFile(relative: string): Env {
  const file = path.join(root, relative);
  return existsSync(file) ? parseDotenv(readFileSync(file, "utf8")) : {};
}

function withoutEmpty(source: Env): Env {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value));
}

// Web values take precedence over worker files; process.env (CI) overrides all.
const merged: Env = withoutEmpty({
  ...readEnvFile("apps/worker-generation/.env"),
  ...readEnvFile("apps/worker-ingestion/.env"),
  ...readEnvFile("apps/web/.env.local"),
  ...process.env,
});
const env: Env = { ...merged, ...aliasedVariables(merged) };
const appEnv = resolveAppEnv(env);

/** Values that must never appear in output: anything secret-like, plus URL passwords. */
const secrets = Object.entries(env).flatMap(([name, value]) => {
  if (!value) return [];
  const found: string[] = [];
  if (/(KEY|TOKEN|SECRET|PASSWORD)/.test(name) && value.length >= 6) found.push(value);
  try {
    const url = new URL(value);
    if (url.password) found.push(url.password);
  } catch {
    // Not a URL.
  }
  return found;
});

function redact(text: string): string {
  return secrets.reduce((output, value) => output.replaceAll(value, "***"), text);
}

function missing(...names: string[]): string[] {
  return names.filter((name) => !env[name]);
}

function eitherMissing(...names: string[]): string[] {
  return names.some((name) => env[name]) ? [] : [names.join(" or ")];
}

const checks: Check[] = [
  {
    id: "postgres",
    service: "Postgres",
    requires: () => eitherMissing("DATABASE_URL", "DIRECT_DATABASE_URL"),
    timeoutMs: 15_000,
    async run(e) {
      const url = e.DIRECT_DATABASE_URL ?? e.DATABASE_URL!;
      const { client, close } = createDb({ url, role: "script" });
      try {
        const [version] = await client<{ server_version: string }[]>`show server_version`;
        const serverVersion = version?.server_version ?? "unknown";
        const extensions = await client<{ name: string; default_version: string }[]>`
          select name, default_version from pg_available_extensions where name in ('vector', 'pg_trgm')`;
        const found = new Map(extensions.map((row) => [row.name, row.default_version]));
        const absent = ["vector", "pg_trgm"].filter((name) => !found.has(name));
        if (absent.length > 0) throw new Error(`extension not available: ${absent.join(", ")}`);
        return `PostgreSQL ${serverVersion.split(" ")[0]}; vector ${found.get("vector")}, pg_trgm ${found.get("pg_trgm")} available`;
      } finally {
        await close();
      }
    },
  },
  {
    id: "upstash",
    service: "Upstash Redis",
    requires: () => missing("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"),
    timeoutMs: 10_000,
    async run(e) {
      const redis = createRedis({
        url: e.UPSTASH_REDIS_REST_URL!,
        token: e.UPSTASH_REDIS_REST_TOKEN!,
      });
      const key = cacheKey(appEnv, "smoke", crypto.randomUUID());
      await redis.set(key, "ok", { ex: 30 });
      const value = await redis.get<string>(key);
      await redis.del(key);
      if (value !== "ok") throw new Error("read back a different value");
      return `set/get/del with TTL ok (${new URL(e.UPSTASH_REDIS_REST_URL!).host})`;
    },
  },
  {
    id: "inngest",
    service: "Inngest",
    requires: (e) =>
      e.INNGEST_DEV === "1" ? [] : missing("INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"),
    timeoutMs: 45_000,
    async run(e) {
      const isDev = e.INNGEST_DEV === "1";
      const baseUrl =
        e.INNGEST_BASE_URL ?? (isDev ? "http://localhost:8288" : "https://api.inngest.com");
      const inngest = createInngest({
        appId: "foliomind-web",
        isDev,
        eventKey: e.INNGEST_EVENT_KEY,
        baseUrl: e.INNGEST_BASE_URL,
      });
      const { ids } = await inngest.send(
        systemPingRequested.create({
          requestedAt: new Date().toISOString(),
          source: "check-services",
        }),
      );
      const eventId = ids[0];
      if (!eventId) throw new Error("event was not accepted");

      // One completed run per connected worker app proves Connect is working.
      const headers: Record<string, string> = isDev
        ? {}
        : { Authorization: `Bearer ${e.INNGEST_SIGNING_KEY}` };
      const deadline = Date.now() + 35_000;
      let runs: { status: string; function_id?: string }[] = [];
      while (Date.now() < deadline) {
        const response = await fetch(`${baseUrl}/v1/events/${eventId}/runs`, { headers });
        if (response.ok) {
          runs = ((await response.json()) as { data?: typeof runs }).data ?? [];
          if (runs.length >= 2 && runs.every((run) => run.status === "Completed")) break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      const completed = runs.filter((run) => run.status === "Completed").length;
      if (completed < 2) {
        throw new Error(
          `ping produced ${completed} completed run(s), expected 2 (one per worker). Are both workers running (pnpm dev)?`,
        );
      }
      return `${isDev ? "Dev Server" : "Inngest Cloud"} reachable; system ping completed by ${completed} worker apps`;
    },
  },
  {
    id: "browserless",
    service: "Browserless",
    requires: () => missing("BROWSERLESS_WS_ENDPOINT", "BROWSERLESS_TOKEN"),
    timeoutMs: 60_000,
    async run(e) {
      const pdf = await renderHtmlToPdf(
        { wsEndpoint: e.BROWSERLESS_WS_ENDPOINT!, token: e.BROWSERLESS_TOKEN! },
        "<!doctype html><html><body><h1>FolioMind</h1></body></html>",
      );
      const header = Buffer.from(pdf.subarray(0, 5)).toString("latin1");
      if (header !== "%PDF-") throw new Error("response is not a PDF");
      return `rendered a ${pdf.byteLength} byte PDF (${new URL(e.BROWSERLESS_WS_ENDPOINT!).host})`;
    },
  },
  {
    id: "jina",
    service: "Jina AI",
    requires: () => missing("JINA_API_KEY"),
    timeoutMs: 30_000,
    async run(e) {
      const dimension = Number(e.JINA_EMBEDDING_DIMENSION ?? 1024);
      const jina = createJina({
        apiKey: e.JINA_API_KEY!,
        embeddingModel: e.JINA_EMBEDDING_MODEL ?? "jina-embeddings-v5-text-small",
        embeddingDimension: dimension,
        rerankerModel: e.JINA_RERANKER_MODEL ?? "jina-reranker-v3.5",
      });
      const embedded = await jina.embed(["FolioMind connectivity check"], {
        task: "retrieval.query",
      });
      const ranked = await jina.rerank(
        "reading research papers",
        ["A guide to reading papers", "A cake recipe"],
        2,
      );
      return `${embedded.model}: ${embedded.dimension}-d vector; rerank ${ranked.model}: ${ranked.results.length} results`;
    },
  },
  {
    id: "gemini",
    service: "Google Gemini",
    requires: () => missing("GEMINI_API_KEY"),
    timeoutMs: 45_000,
    async run(e) {
      const gemini = createGemini({ apiKey: e.GEMINI_API_KEY! });
      const chatModel = e.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";
      const generationModel = e.GEMINI_GENERATION_MODEL ?? "gemini-3.6-flash";
      const available = await gemini.listModelNames();
      const unknown = [chatModel, generationModel].filter((model) => !available.includes(model));
      if (unknown.length > 0) {
        throw new Error(`model not available to this key: ${[...new Set(unknown)].join(", ")}`);
      }
      const text = await gemini.generateText({
        model: chatModel,
        prompt: "Reply with the single word OK.",
        maxOutputTokens: 20,
      });
      const structured = await gemini.generateStructured(z.object({ ok: z.boolean() }), {
        model: chatModel,
        prompt: "Return a JSON object with the field ok set to true.",
      });
      if (!structured.data.ok) throw new Error("structured output returned ok=false");
      return `${chatModel}: text (${text.usage.totalTokens} tokens) and structured output ok; ${available.length} models available`;
    },
  },
  {
    id: "uploadthing",
    service: "UploadThing",
    requires: () => missing("UPLOADTHING_TOKEN"),
    timeoutMs: 20_000,
    async run(e) {
      const utapi = new UTApi({ token: e.UPLOADTHING_TOKEN! });
      const { files } = await utapi.listFiles({ limit: 1 });
      return `authenticated; listFiles returned ${files.length} file(s)`;
    },
  },
  {
    id: "stripe",
    service: "Stripe",
    requires: () => missing("STRIPE_SECRET_KEY"),
    timeoutMs: 20_000,
    async run(e) {
      const key = e.STRIPE_SECRET_KEY!;
      if (appEnv !== "production" && !isStripeTestKey(key)) {
        throw new Error(`a live key is configured for APP_ENV=${appEnv}; use a test-mode key`);
      }
      const stripe = createStripe(key);
      const balance = await stripe.balance.retrieve();
      return `${balance.livemode ? "live" : "test"} mode; balance retrieved (API ${stripe.getApiField("version")})`;
    },
  },
  {
    id: "auth0",
    service: "Auth0",
    requires: () =>
      missing("AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"),
    timeoutMs: 20_000,
    async run(e) {
      const domain = e.AUTH0_DOMAIN!;
      const discovery = await fetch(`https://${domain}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!discovery.ok) throw new Error(`OIDC discovery returned HTTP ${discovery.status}`);
      const { issuer } = (await discovery.json()) as { issuer: string };
      if (!e.AUTH0_MGMT_CLIENT_ID || !e.AUTH0_MGMT_CLIENT_SECRET) {
        return `tenant reachable (${issuer}); Management API credentials not set`;
      }
      const token = await fetch(`https://${domain}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: e.AUTH0_MGMT_CLIENT_ID,
          client_secret: e.AUTH0_MGMT_CLIENT_SECRET,
          audience: `https://${domain}/api/v2/`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!token.ok) throw new Error(`Management API token request returned HTTP ${token.status}`);
      return `tenant reachable (${issuer}); Management API token issued`;
    },
  },
  {
    id: "pushengage",
    service: "PushEngage",
    requires: () => missing("PUSHENGAGE_API_KEY"),
    timeoutMs: 15_000,
    async run(e) {
      const { count } = await createPushEngage({ apiKey: e.PUSHENGAGE_API_KEY! }).listNotifications(
        1,
      );
      return `authenticated; notifications endpoint returned ${count} item(s)`;
    },
  },
];

async function runCheck(check: Check, selected: boolean) {
  const absent = check.requires(env);
  if (!selected)
    return { check, configured: absent.length === 0, status: "skipped" as Status, detail: "" };
  if (absent.length > 0) {
    return {
      check,
      configured: false,
      status: "not configured" as Status,
      detail: `set ${absent.join(", ")}`,
    };
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const detail = await Promise.race([
      check.run(env),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${check.timeoutMs / 1000}s`)),
          check.timeoutMs,
        );
      }),
    ]);
    return { check, configured: true, status: "pass" as Status, detail: redact(detail) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { check, configured: true, status: "fail" as Status, detail: redact(message) };
  } finally {
    clearTimeout(timer);
  }
}

const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : undefined;
const unknownIds = only ? [...only].filter((id) => !checks.some((check) => check.id === id)) : [];
if (unknownIds.length > 0) {
  console.error(
    `Unknown check(s): ${unknownIds.join(", ")}. Available: ${checks.map((c) => c.id).join(", ")}`,
  );
  process.exit(2);
}

console.log(`FolioMind service checks (APP_ENV=${appEnv})\n`);
const results = await Promise.all(
  checks.map((check) => runCheck(check, !only || only.has(check.id))),
);

const rows = results.map((r) => [r.check.service, r.configured ? "yes" : "no", r.status, r.detail]);
const header = ["Service", "Configured", "Result", "Detail"];
const widths = header.map((title, i) =>
  Math.max(title.length, ...rows.map((row) => row[i]!.length)),
);
const line = (cells: string[]) =>
  cells.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]!) : cell)).join("  ");
console.log(line(header));
console.log(widths.map((width, i) => "-".repeat(i < 3 ? width : Math.min(width, 60))).join("  "));
for (const row of rows) console.log(line(row));

const failed = results.filter((r) => r.status === "fail");
const unconfigured = results.filter((r) => r.status === "not configured");
console.log(
  `\n${results.filter((r) => r.status === "pass").length} passed, ${failed.length} failed, ${unconfigured.length} not configured, ${results.filter((r) => r.status === "skipped").length} skipped`,
);
// Let open sockets close instead of calling process.exit(): exiting while
// handles are closing crashes Node on Windows (libuv UV_HANDLE_CLOSING assertion).
process.exitCode = failed.length > 0 ? 1 : 0;
setTimeout(() => process.exit(), 10_000).unref();
