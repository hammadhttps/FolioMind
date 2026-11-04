import { ProviderError } from "@foliomind/contracts";
import type { JinaClient } from "@foliomind/ai/jina";
import type { Database } from "@foliomind/db";
import { JobFailure, JobStopped } from "@foliomind/domain";
import type { BrowserlessConfig } from "@foliomind/pdf";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { Extractor } from "../../ingestion/extraction";

/*
 * What Worker A's functions need, injected by the worker (and by tests): the
 * database, provider clients, the sandboxed extractor and file storage. The
 * functions themselves hold no configuration.
 */

export interface StoredFile {
  key: string;
  size: number;
}

/** UploadThing through `UTApi`, reduced to what the workflows use. */
export interface FileStore {
  /** Server-side download address of a stored file. */
  url(fileKey: string): string;
  /** The file an earlier attempt stored under `customId` (Section 25: look up before re-uploading). */
  find(customId: string): Promise<StoredFile | null>;
  /** Uploads a file under `customId`. */
  upload(input: { name: string; data: Uint8Array; customId: string }): Promise<StoredFile>;
  /** Deletes stored files; resolves true when the provider confirmed. */
  delete(fileKeys: readonly string[]): Promise<boolean>;
  /** Stored files, oldest first, for the orphan sweep. */
  list(input: { limit: number; offset: number }): Promise<{ key: string; uploadedAt: Date }[]>;
}

export interface WorkerLogger {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
  error(object: Record<string, unknown>, message?: string): void;
}

export interface WorkerADeps {
  db: Database;
  jina: JinaClient | null;
  extract: Extractor;
  files: FileStore;
  browserless: BrowserlessConfig;
  embedding: { model: string; dimension: number };
  /** How stored files are shared (the free UploadThing plan has public files only). */
  fileAcl: "public" | "private";
  concurrency: { ingestion: number; imports: number; control: number };
  /** Cron schedule of `dispatch-outbox` (Section 9 default: every minute). */
  outboxCron: string;
  /** Delete stored files no asset knows about; only where one UploadThing app serves one environment. */
  orphanFileSweep: boolean;
  /** FolioMind's own hostnames, refused as import targets. */
  ownHosts: readonly string[];
  logger: WorkerLogger;
  tempDir?: string;
}

/**
 * Section 9: control functions (outbox, notifications, cleanup, billing later)
 * share one limit so they keep running while an ingestion holds its own slot.
 */
export const controlConcurrency = (limit: number) => ({
  limit,
  key: '"worker-a-control"',
  scope: "env" as const,
});

/**
 * Maps failures to Inngest semantics (Section 9): stopped jobs and safe-code
 * failures never retry; provider errors with retry-after become
 * `RetryAfterError`; other retryable provider errors retry with backoff; other
 * provider 4xx stop.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toInngestError(error);
  }
}

export function toInngestError(error: unknown): unknown {
  if (error instanceof NonRetriableError || error instanceof RetryAfterError) return error;
  if (error instanceof JobStopped) return new NonRetriableError("cancelled", { cause: error });
  if (error instanceof JobFailure) return new NonRetriableError(error.code, { cause: error });
  if (error instanceof ProviderError) {
    if (error.retryable && error.retryAfterMs !== undefined) {
      return new RetryAfterError("provider_unavailable", Math.max(1000, error.retryAfterMs), {
        cause: error,
      });
    }
    if (error.retryable) return error;
    return new NonRetriableError("provider_unavailable", { cause: error });
  }
  return error;
}

/** Whether a failure means "the owner stopped this" rather than a real failure. */
export function isStopped(error: { message?: string } | undefined): boolean {
  return (error?.message ?? "").split(":")[0]?.trim() === "cancelled";
}
