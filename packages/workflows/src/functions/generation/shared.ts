import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GenerationDailyLimitError,
  GenerationOutputError,
  type GenerationRun,
} from "@foliomind/ai/generation";
import type { GeminiClient } from "@foliomind/ai";
import type { JinaClient } from "@foliomind/ai/jina";
import { estimateGeminiCost } from "@foliomind/ai/pricing";
import {
  retrieve,
  shouldAbstainFromScore,
  type Passage,
  type RetrieveDeps,
} from "@foliomind/ai/retrieval";
import { MAX_SOURCE_PDF_BYTES, ProviderError } from "@foliomind/contracts";
import type { Database } from "@foliomind/db";
import { JobFailure, recordAiRun, type CacheKeys, type UsableSource } from "@foliomind/domain";
import type { BrowserlessConfig } from "@foliomind/pdf";
import type { Redis } from "@upstash/redis";
import type { Extractor } from "../../ingestion/extraction";
import { guarded, type FileStore, type WorkerLogger } from "../ingestion/shared";

/*
 * What Worker B's functions need (blueprint Section 9), injected by whichever
 * host runs them: the Vercel route, the Docker worker or a test.
 */

export interface WorkerBDeps {
  db: Database;
  /** Null when a key isn't set: generation then fails with a clear reason. */
  gemini: GeminiClient | null;
  jina: JinaClient | null;
  redis: Redis | null;
  cacheKeys: CacheKeys;
  models: { generation: string; fast: string };
  embedding: { model: string; dimension: number };
  browserless: BrowserlessConfig | null;
  files: FileStore;
  fileAcl: "public" | "private";
  /** The sandboxed PDF parser, used here only to count an export's pages. */
  extract: Extractor;
  /** `GENERATION_CONCURRENCY`: runs allowed at once across all four functions. */
  heavyConcurrency: number;
  logger: WorkerLogger;
  tempDir?: string;
}

/**
 * Section 9: one heavy run at a time across generation and export, enforced by
 * one key shared by all four functions instead of a hand-written semaphore.
 */
export const heavyConcurrency = (limit: number) => ({
  limit,
  key: '"worker-b-heavy"',
  scope: "env" as const,
});

/** Failures with a code the owner can read; everything else follows `guarded`. */
export function guardedGeneration<T>(fn: () => Promise<T>): Promise<T> {
  return guarded(async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GenerationDailyLimitError) {
        throw new JobFailure("provider_daily_limit");
      }
      if (error instanceof GenerationOutputError) throw new JobFailure("generation_failed");
      throw error;
    }
  });
}

export function requireGemini(deps: WorkerBDeps): GeminiClient {
  if (!deps.gemini) throw new JobFailure("provider_unavailable");
  return deps.gemini;
}

export const generationDeps = (deps: WorkerBDeps) => ({
  gemini: requireGemini(deps),
  model: deps.models.generation,
  fallbackModel: deps.models.fast,
});

/**
 * Evidence for one request (Section 8: separately per section, never whole
 * PDFs). Nothing relevant comes back empty, so no request is spent guessing.
 * The passages stay inside the step: document text never enters run state.
 */
export async function findEvidence(
  deps: WorkerBDeps,
  input: { ownerId: string; question: string; sources: readonly UsableSource[] },
): Promise<Passage[]> {
  if (input.sources.length === 0) return [];
  if (!deps.jina) throw new JobFailure("provider_unavailable");
  const retrieval: RetrieveDeps = {
    db: deps.db,
    jina: deps.jina,
    redis: deps.redis,
    cacheKeys: deps.cacheKeys,
    embeddingModel: deps.embedding.model,
    embeddingDimension: deps.embedding.dimension,
  };
  const result = await retrieve(retrieval, {
    userId: input.ownerId,
    question: input.question,
    sources: input.sources,
  });
  // Chat answers from full text alone when embeddings fail, because a reader is
  // waiting. A draft can wait, and writing "not covered" during an outage would be untrue.
  if (result.metadata.embeddingFailed) {
    throw new ProviderError("Jina", "query embedding failed", { retryable: true });
  }
  return shouldAbstainFromScore(result.metadata) ? [] : result.passages;
}

/** Counts and cost only; never the prompt or the text (Section 8). */
export async function recordGeneration(
  deps: WorkerBDeps,
  input: {
    ownerId: string;
    jobId: string;
    purpose: "project-outline" | "project-section";
    run: GenerationRun | null;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.run) return;
  await recordAiRun(deps.db, {
    userId: input.ownerId,
    jobId: input.jobId,
    purpose: input.purpose,
    provider: "gemini",
    model: input.run.model,
    inputTokens: input.run.usage.inputTokens,
    outputTokens: input.run.usage.outputTokens + input.run.usage.thoughtTokens,
    estimatedCost: estimateGeminiCost(input.run.model, input.run.usage),
    latencyMs: input.run.latencyMs,
    status: "succeeded",
    metadata: { ...input.metadata, requests: input.run.requests },
  });
}

/** Section 26: 200 pages at most. Above that, or if the file won't parse, the export fails. */
export async function countExportPages(
  deps: Pick<WorkerBDeps, "extract" | "tempDir">,
  pdf: Uint8Array,
  maxPages: number,
): Promise<number> {
  const folder = await mkdtemp(path.join(deps.tempDir ?? os.tmpdir(), "foliomind-export-"));
  try {
    const file = path.join(folder, "export.pdf");
    await writeFile(file, pdf);
    const outcome = await deps.extract(file, { mode: "validate", maxPages });
    if (outcome.ok) return outcome.pageCount;
    throw new JobFailure(outcome.code === "too_many_pages" ? "export_too_large" : "export_failed");
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Same ceiling as uploads, so an export can't take more storage than a source can. */
export const MAX_EXPORT_BYTES = MAX_SOURCE_PDF_BYTES;
