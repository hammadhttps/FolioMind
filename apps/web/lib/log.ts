/*
 * Structured log lines (blueprint Section 14): an event name, the release that
 * wrote it, and safe fields only: IDs, codes, counts and error names, never
 * document text, prompts, emails or tokens. Vercel exposes the deployment's
 * commit as VERCEL_GIT_COMMIT_SHA; a Docker deployment can set RELEASE_ID.
 */

export const RELEASE = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RELEASE_ID ||
  "local"
).slice(0, 12);

type Level = "info" | "warn" | "error";

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ event, level, release: RELEASE, ...fields }));
}

/**
 * The safe parts of an error: its name and, for provider errors such as
 * Stripe's (whose name is plain "Error"), the type, code and HTTP status.
 * Never the message, which can quote request data.
 */
export function errorFields(error: unknown): Record<string, unknown> {
  const value = (error ?? {}) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof value[key] === "string" || typeof value[key] === "number" ? value[key] : undefined;
  return {
    name: pick("name"),
    type: pick("type"),
    code: pick("code"),
    statusCode: pick("statusCode"),
  };
}
