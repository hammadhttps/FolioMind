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
