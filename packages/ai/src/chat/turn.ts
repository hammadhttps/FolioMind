import {
  CHAT_ERRORS,
  ProviderError,
  type ChatErrorCode,
  type ChatEvent,
  type ChatFocus,
  type ChatRequest,
  type MessageStatus,
  type QuestionAllowance,
} from "@foliomind/contracts";
import { aiRuns, type Database } from "@foliomind/db";
import {
  commit,
  createConversation,
  deleteEmptyConversation,
  getConversation,
  getReadableDocument,
  invalidateUsageSummary,
  ownsWorkspace,
  questionAllowance,
  recentHistory,
  release,
  reserve,
  saveExchange,
  setCitationSupport,
  threadTitle,
  type Actor,
  type CacheKeys,
  type ConversationRow,
} from "@foliomind/domain";
import type { Redis } from "@upstash/redis";
import { isDailyQuotaError, type GeminiClient, type TokenUsage } from "../gemini";
import type { JinaClient } from "../jina";
import { estimateGeminiCost, estimateJinaCost } from "../pricing";
import { RETRIEVAL, type RetrievalMetadata, retrieve } from "../retrieval";
import { historyForRewrite, rewriteFollowUp } from "../retrieval/rewrite";
import { resolveSources, type ResolvedSource, type SourceScope } from "../retrieval/sources";
import { abstentionMessage, shouldAbstain } from "./abstain";
import { streamAnswer, type AnswerResult } from "./answer";
import { labelPassages, mapCitations, type LabeledPassage, type MappedAnswer } from "./citations";
import { checkSupport } from "./support";

/*
 * One question, end to end (blueprint Section 8 "Question answering").
 *
 * `prepareChatTurn` does everything that can still answer with a plain HTTP
 * error: scope and access, then the quota reservation. `runChatTurn` then yields
 * the streamed events. Whatever happens the reservation is resolved: committed
 * when an answer is stored, released on failure or when the reader stops it.
 */

const RESERVATION_MS = 15 * 60 * 1000;

export interface ChatDeps {
  db: Database;
  jina: JinaClient;
  gemini: GeminiClient;
  redis: Redis | null;
  cacheKeys: CacheKeys;
  models: {
    answer: string;
    fast: string;
    embedding: string;
    embeddingDimension: number;
  };
  /** IDs, codes and timings only. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface ChatTurn {
  actor: Actor;
  operationKey: string;
  conversation: ConversationRow;
  created: boolean;
  scopeKind: "document" | "workspace";
  sources: ResolvedSource[];
  question: string;
  focus: ChatFocus | null;
  startedAt: Date;
}

export type PrepareResult =
  | { ok: true; turn: ChatTurn }
  | {
      ok: false;
      status: number;
      code: ChatErrorCode;
      message: string;
      allowance?: QuestionAllowance;
    };

const refuse = (status: number, code: ChatErrorCode, allowance?: QuestionAllowance) =>
  ({
    ok: false,
    status,
    code,
    message: CHAT_ERRORS[code],
    ...(allowance ? { allowance } : {}),
  }) as const;

export async function prepareChatTurn(
  deps: Pick<ChatDeps, "db">,
  actor: Actor,
  input: ChatRequest,
): Promise<PrepareResult> {
  const { db } = deps;
  let conversation: ConversationRow | null = null;
  let scope: SourceScope;

  if (input.conversationId) {
    // A stored thread's scope always wins over anything else in the request.
    conversation = await getConversation(db, actor.id, input.conversationId);
    if (!conversation) return refuse(404, "not_found");
    scope = conversation.workspaceId
      ? {
          kind: "workspace",
          workspaceId: conversation.workspaceId,
          selectedVersionIds: input.sourceVersionIds,
        }
      : { kind: "document", versionId: conversation.documentVersionId! };
  } else if (input.scope?.kind === "document") {
    const document = await getReadableDocument(db, actor, input.scope.documentId);
    if (!document) return refuse(404, "not_found");
    scope = { kind: "document", versionId: document.version.id };
  } else if (input.scope?.kind === "workspace") {
    if (!(await ownsWorkspace(db, actor, input.scope.workspaceId))) {
      return refuse(404, "not_found");
    }
    scope = {
      kind: "workspace",
      workspaceId: input.scope.workspaceId,
      selectedVersionIds: input.sourceVersionIds,
    };
  } else {
    return refuse(400, "invalid");
  }

  const sources = await resolveSources(db, actor, scope);
  if (sources.length === 0) return refuse(409, "no_sources");

  const startedAt = new Date();
  const operationKey = `chat:${actor.id}:${input.clientMessageId}`;
  const reservation = await reserve(db, {
    userId: actor.id,
    metric: "ai_questions",
    quantity: 1,
    operationKey,
    expiresAt: new Date(startedAt.getTime() + RESERVATION_MS),
  });
  if (!reservation.ok) {
    return reservation.code === "quota_exceeded"
      ? refuse(409, "quota_exceeded", await questionAllowance(db, actor.id))
      : refuse(409, "duplicate");
  }
  if (reservation.replayed) return refuse(409, "duplicate");

  const created = conversation === null;
  conversation ??= await createConversation(db, {
    userId: actor.id,
    title: threadTitle(input.message),
    scope:
      scope.kind === "workspace"
        ? { kind: "workspace", workspaceId: scope.workspaceId }
        : { kind: "document", versionId: scope.versionId },
  });
  return {
    ok: true,
    turn: {
      actor,
      operationKey,
      conversation,
      created,
      scopeKind: scope.kind,
      sources,
      question: input.message,
      // Selected text belongs to a document; a workspace question has none.
      focus: scope.kind === "document" ? (input.focus ?? null) : null,
      startedAt,
    },
  };
}

const zeroUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 };

interface RunRecord {
  purpose: "chat-answer" | "chat-rewrite" | "chat-support-check";
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  status: string;
  jinaTokens?: number;
  metadata?: Record<string, unknown>;
}

async function recordRun(deps: ChatDeps, userId: string, run: RunRecord): Promise<string | null> {
  try {
    const cost = estimateGeminiCost(run.model, run.usage) + estimateJinaCost(run.jinaTokens ?? 0);
    const [row] = await deps.db
      .insert(aiRuns)
      .values({
        userId,
        purpose: run.purpose,
        provider: "gemini",
        model: run.model,
        inputTokens: run.usage.inputTokens,
        // Thinking is billed as output.
        outputTokens: run.usage.outputTokens + run.usage.thoughtTokens,
        estimatedCost: cost.toFixed(8),
        latencyMs: Math.max(0, Math.round(run.latencyMs)),
        status: run.status,
        retrievalMetadata: { thoughtTokens: run.usage.thoughtTokens, ...run.metadata },
      })
      .returning({ id: aiRuns.id });
    return row?.id ?? null;
  } catch (error) {
    // Bookkeeping never costs a reader their answer.
    deps.log?.("chat.run_record_failed", { purpose: run.purpose, error: errorName(error) });
    return null;
  }
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

const failureCode = (error: unknown): ChatErrorCode => {
  if (isDailyQuotaError(error)) return "provider_daily_limit";
  return error instanceof ProviderError && (error.status === 429 || error.status === 503)
    ? "provider_busy"
    : "failed";
};

class EmptyAnswerError extends Error {}

/**
 * Yields the turn's events. Keep draining it after the reader disconnects:
 * ending early would skip saving and resolving the reservation. Abort through
 * `signal` instead.
 */
export async function* runChatTurn(
  deps: ChatDeps,
  turn: ChatTurn,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const { db } = deps;
  const { actor, conversation } = turn;
  const scopeMetadata = { scope: turn.scopeKind, focus: turn.focus !== null };

  let metadata: RetrievalMetadata | null = null;
  let passages: LabeledPassage[] = [];
  let partial = "";
  let usage = zeroUsage;
  let model = deps.models.answer;
  let firstTokenMs: number | null = null;
  let rewritten = false;

  const elapsed = () => Date.now() - turn.startedAt.getTime();
  const jinaTokens = () => (metadata ? metadata.tokens.embedding + metadata.tokens.rerank : 0);
  const runMetadata = () => ({ ...scopeMetadata, rewritten, firstTokenMs, retrieval: metadata });

  /** Stores the exchange; commits or releases the reservation by outcome. */
  const finish = async (
    mapped: MappedAnswer,
    status: MessageStatus,
    charge: boolean,
    runStatus: string,
  ) => {
    const aiRunId = await recordRun(deps, actor.id, {
      purpose: "chat-answer",
      model,
      usage,
      latencyMs: elapsed(),
      status: runStatus,
      jinaTokens: jinaTokens(),
      metadata: { ...runMetadata(), unknownLabels: mapped.unknownLabels.length },
    });
    const saved = await saveExchange(db, actor, {
      conversationId: conversation.id,
      question: { body: turn.question, focus: turn.focus, at: turn.startedAt },
      answer: {
        body: mapped.body,
        status,
        aiRunId,
        citations: mapped.citations,
        at: new Date(),
      },
    });
    const resolved = charge
      ? await commit(db, turn.operationKey)
      : await release(db, turn.operationKey);
    if (resolved.ok) await invalidateUsageSummary(deps.redis, deps.cacheKeys, resolved);
    return saved;
  };

  /** A failure stores nothing; the reader's question stays in their composer. */
  const abandon = async (runStatus: string, code?: string) => {
    await recordRun(deps, actor.id, {
      purpose: "chat-answer",
      model,
      usage,
      latencyMs: elapsed(),
      status: runStatus,
      jinaTokens: jinaTokens(),
      metadata: { ...runMetadata(), ...(code ? { errorCode: code } : {}) },
    });
    const resolved = await release(db, turn.operationKey);
    if (resolved.ok) await invalidateUsageSummary(deps.redis, deps.cacheKeys, resolved);
    if (turn.created) await deleteEmptyConversation(db, conversation.id);
  };

  /** The reader pressed Stop or left: keep what they saw, charge nothing (Phase 7 skill). */
  const stopped = async () => {
    if (partial.trim()) {
      await finish(mapCitations(partial, passages), "stopped", false, "stopped");
    } else {
      await abandon("stopped");
    }
    deps.log?.("chat.stopped", { conversationId: conversation.id, latencyMs: elapsed() });
  };

  yield {
    type: "start",
    conversationId: conversation.id,
    title: conversation.title,
    created: turn.created,
  };

  let completed: Awaited<ReturnType<typeof finish>> | null = null;
  let answerText: MappedAnswer | null = null;
  try {
    yield { type: "status", phase: "searching" };
    const history = turn.created
      ? []
      : historyForRewrite(await recentHistory(db, conversation.id, RETRIEVAL.historyMessages));
    const rewrite = await rewriteFollowUp(
      { gemini: deps.gemini, model: deps.models.fast },
      history,
      turn.question,
      signal,
    );
    rewritten = rewrite.rewritten;
    if (rewrite.run) {
      await recordRun(deps, actor.id, {
        purpose: "chat-rewrite",
        model: rewrite.run.model,
        usage: rewrite.run.usage,
        latencyMs: rewrite.run.latencyMs,
        status: rewrite.run.failed ? "failed" : "succeeded",
      });
    }
    signal.throwIfAborted();

    const retrieval = await retrieve(
      {
        db,
        jina: deps.jina,
        redis: deps.redis,
        cacheKeys: deps.cacheKeys,
        embeddingModel: deps.models.embedding,
        embeddingDimension: deps.models.embeddingDimension,
      },
      {
        userId: actor.id,
        question: rewrite.question,
        sources: turn.sources,
        focus: turn.focus,
      },
    );
    metadata = retrieval.metadata;
    signal.throwIfAborted();

    if (shouldAbstain(metadata)) {
      answerText = {
        body: abstentionMessage(turn.scopeKind),
        citations: [],
        unknownLabels: [],
      };
      completed = await finish(answerText, "abstained", true, "abstained");
    } else {
      passages = labelPassages(retrieval.passages);
      yield { type: "status", phase: "answering" };

      const stream = streamAnswer(
        { gemini: deps.gemini, model: deps.models.answer, fallbackModel: deps.models.fast },
        {
          question: rewrite.question,
          passages,
          focus: turn.focus,
          sourceCount: new Set(passages.map((passage) => passage.versionId)).size,
          signal,
        },
      );
      let result: AnswerResult | undefined;
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          result = next.value;
          break;
        }
        partial += next.value;
        yield { type: "delta", text: next.value };
      }
      firstTokenMs = result.firstTokenMs;
      if (result.end) {
        usage = result.end.usage;
        model = result.end.model;
      }
      signal.throwIfAborted();
      if (!result.text) throw new EmptyAnswerError();

      answerText = result.insufficient
        ? { body: result.text, citations: [], unknownLabels: [] }
        : mapCitations(result.text, passages);
      completed = await finish(
        answerText,
        result.insufficient ? "abstained" : "complete",
        true,
        result.insufficient ? "abstained" : "succeeded",
      );
    }
  } catch (error) {
    if (signal.aborted) {
      await stopped();
      return;
    }
    const code = failureCode(error);
    deps.log?.("chat.failed", {
      conversationId: conversation.id,
      code,
      status: error instanceof ProviderError ? error.status : undefined,
      provider: error instanceof ProviderError ? error.provider : undefined,
      error: errorName(error),
    });
    await abandon("failed", code);
    yield { type: "error", code, message: CHAT_ERRORS[code], retryable: true };
    return;
  }

  yield {
    type: "done",
    question: completed.question,
    answer: completed.answer,
    allowance: await questionAllowance(db, actor.id),
  };

  // The answer is saved and counted. The check adds a verdict only if it succeeds.
  if (completed.answer.citations.length === 0 || signal.aborted) return;
  const check = await checkSupport(
    { gemini: deps.gemini, model: deps.models.fast },
    { body: completed.answer.body, passages },
  );
  if (!check) return;
  await recordRun(deps, actor.id, {
    purpose: "chat-support-check",
    model: check.run.model,
    usage: check.run.usage,
    latencyMs: check.run.latencyMs,
    status: check.run.status,
    metadata: { claims: check.claims, unsupportedClaims: check.unsupportedClaims },
  });
  const ids = new Map(completed.answer.citations.map((citation) => [citation.label, citation.id]));
  const verdicts = check.verdicts.flatMap(({ label, support }) => {
    const citationId = ids.get(label);
    return citationId ? [{ citationId, support }] : [];
  });
  if (verdicts.length === 0) return;
  try {
    await setCitationSupport(db, verdicts);
  } catch (error) {
    deps.log?.("chat.support_save_failed", { error: errorName(error) });
    return;
  }
  yield {
    type: "verified",
    messageId: completed.answer.id,
    citations: verdicts.map(({ citationId, support }) => ({ id: citationId, support })),
  };
}
