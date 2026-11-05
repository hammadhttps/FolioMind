import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { createGemini, createJina, isDailyQuotaError } from "@foliomind/ai";
import {
  ANSWER_SETTINGS,
  checkSupport,
  labelPassages,
  mapCitations,
  shouldAbstain,
  streamAnswer,
} from "@foliomind/ai/chat";
import {
  documentByKey,
  EVAL_DOCUMENTS,
  EVAL_QUESTIONS,
  suggestThreshold,
  summarize,
  type EvalDocument,
  type EvalQuestion,
  type GeneratedAnswer,
  type Located,
  type QuestionResult,
} from "@foliomind/ai/eval";
import { estimateGeminiCost, estimateJinaCost } from "@foliomind/ai/pricing";
import { RETRIEVAL, retrieve, selectPassages, type Passage } from "@foliomind/ai/retrieval";
import { ProviderError } from "@foliomind/contracts";
import {
  assets,
  createDb,
  documentChunks,
  documents,
  documentVersions,
  users,
} from "@foliomind/db";
import { runMigrations } from "@foliomind/db/migrate";
import { cacheKeys } from "@foliomind/domain";
import { chunkPages } from "@foliomind/workflows/chunking";
import { eq } from "drizzle-orm";
import postgres from "postgres";

/*
 * `pnpm eval:retrieval` (blueprint Section 8 "Evaluation"). Builds the evaluation
 * documents in a local database of their own with the production chunker and
 * real embeddings, then asks the curated questions through the production
 * retrieval, answer and citation code. Prints hit rates for embedding-only,
 * fused and reranked retrieval, then correct page citations, unsupported claims,
 * abstention accuracy, adversarial results, latency and estimated cost.
 *
 *   pnpm eval:retrieval                    the whole set
 *   pnpm eval:retrieval --retrieval-only   no Gemini, which is quick and uses no quota
 *   pnpm eval:retrieval --kind adversarial one kind
 *   pnpm eval:retrieval --delay 13         seconds between Gemini answers (free tier)
 *   pnpm eval:retrieval --json out.json    keep every per-question result
 *
 * Needs JINA_API_KEY, and GEMINI_API_KEY unless --retrieval-only, in the
 * environment or apps/web/.env.local. GEMINI_CHAT_MODEL chooses the model under
 * test, with no fallback, so results belong to that model. The free tier allows
 * 20 requests a day per model, so a whole run may need a second model or a paid
 * key; the run stops cleanly at the limit and reports what it has. Nothing here
 * touches Neon: it refuses any database that isn't on this machine.
 */

const { values: args } = parseArgs({
  options: {
    "retrieval-only": { type: "boolean", default: false },
    kind: { type: "string" },
    only: { type: "string" },
    limit: { type: "string" },
    delay: { type: "string" },
    json: { type: "string" },
    threshold: { type: "string" },
    "database-url": { type: "string" },
  },
});

const repoRoot = path.resolve(import.meta.dirname, "..");
const envFile = path.join(repoRoot, "apps/web/.env.local");
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const setting = (name: string, fallback?: string): string => {
  const value = process.env[name] || fileEnv[name] || fallback;
  if (!value) throw new Error(`Set ${name} in the environment or apps/web/.env.local.`);
  return value;
};

const retrievalOnly = args["retrieval-only"];
const delayMs = Number(args.delay ?? (retrievalOnly ? 0 : 13)) * 1000;
const abstainScore = Number(args.threshold ?? RETRIEVAL.abstainScore);
const DATABASE_URL =
  args["database-url"] ?? "postgres://foliomind:foliomind@localhost:5433/foliomind_eval_test";
const host = new URL(DATABASE_URL).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error("The evaluation only runs against a database on this machine.");
}

const EMBEDDING_MODEL = setting("JINA_EMBEDDING_MODEL", "jina-embeddings-v5-text-small");
const EMBEDDING_DIMENSION = Number(setting("JINA_EMBEDDING_DIMENSION", "1024"));
const ANSWER_MODEL = setting("GEMINI_CHAT_MODEL", "gemini-3.6-flash");
const FAST_MODEL = setting("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite");

const jina = createJina({
  apiKey: setting("JINA_API_KEY"),
  embeddingModel: EMBEDDING_MODEL,
  embeddingDimension: EMBEDDING_DIMENSION,
  rerankerModel: setting("JINA_RERANKER_MODEL", "jina-reranker-v3.5"),
});
const gemini = retrievalOnly ? null : createGemini({ apiKey: setting("GEMINI_API_KEY") });

/* --- The evaluation database ------------------------------------------ */

async function freshDatabase() {
  const name = new URL(DATABASE_URL).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error("Use a database whose name ends in _test.");
  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end({ timeout: 5 });
  await runMigrations(DATABASE_URL);
}

/** Passage embeddings are reused across runs, so changing questions costs nothing. */
const cacheFile = path.join(repoRoot, "node_modules/.cache/foliomind-eval/embeddings.json");
const embeddingCache: Record<string, number[]> = existsSync(cacheFile)
  ? (JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, number[]>)
  : {};

async function embedPassages(texts: string[]): Promise<number[][]> {
  const key = (text: string) =>
    createHash("sha256").update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMENSION}:${text}`).digest("hex");
  const missing = texts.filter((text) => !embeddingCache[key(text)]);
  for (let index = 0; index < missing.length; index += 32) {
    const batch = missing.slice(index, index + 32);
    const { embeddings } = await jina.embed(batch, { task: "retrieval.passage" });
    batch.forEach((text, position) => {
      embeddingCache[key(text)] = embeddings[position]!;
    });
  }
  if (missing.length > 0) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(embeddingCache));
  }
  return texts.map((text) => embeddingCache[key(text)]!);
}

interface SeededSource {
  key: string;
  versionId: string;
  documentId: string;
  title: string;
}

/** The chunker's input, as the extraction step would produce it. */
function chunkInput(document: EvalDocument) {
  return document.pages.map((page, index) => {
    const heading = page.heading ? `${page.heading}\n\n` : "";
    return {
      pageNumber: index + 1,
      text: `${heading}${page.paragraphs.join("\n\n")}`,
      headings: page.heading ? [{ text: page.heading, level: 1, offset: 0 }] : [],
    };
  });
}

async function seed(db: ReturnType<typeof createDb>["db"], userId: string) {
  const sources = new Map<string, SeededSource>();
  let chunkCount = 0;
  for (const document of EVAL_DOCUMENTS) {
    const chunks = chunkPages(chunkInput(document));
    chunkCount += chunks.length;
    const embeddings = await embedPassages(
      chunks.map((chunk) => (chunk.heading ? `${chunk.heading}\n\n${chunk.text}` : chunk.text)),
    );
    const [asset] = await db
      .insert(assets)
      .values({
        ownerId: userId,
        fileKey: `eval-${randomUUID()}`,
        customId: `eval-${randomUUID()}`,
        fileRoute: "sourcePdf",
        acl: "private",
        purpose: "source",
        bytes: 1,
        mimeType: "application/pdf",
        state: "ready",
      })
      .returning({ id: assets.id });
    const [row] = await db
      .insert(documents)
      .values({ ownerId: userId, title: document.title, sourceKind: "upload" })
      .returning({ id: documents.id });
    const [version] = await db
      .insert(documentVersions)
      .values({
        documentId: row!.id,
        versionNo: 1,
        assetId: asset!.id,
        status: "ready",
        pageCount: document.pages.length,
        indexVersion: "eval",
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimension: EMBEDDING_DIMENSION,
      })
      .returning({ id: documentVersions.id });
    await db
      .update(documents)
      .set({ currentVersionId: version!.id })
      .where(eq(documents.id, row!.id));
    await db.insert(documentChunks).values(
      chunks.map((chunk, index) => ({
        documentVersionId: version!.id,
        chunkIndex: chunk.chunkIndex,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        heading: chunk.heading,
        text: chunk.text,
        charOffsets: chunk.charOffsets,
        tokenCount: chunk.tokenCount,
        contentHash: chunk.contentHash,
        embedding: embeddings[index]!,
      })),
    );
    sources.set(document.key, {
      key: document.key,
      versionId: version!.id,
      documentId: row!.id,
      title: document.title,
    });
  }
  return { sources, chunkCount };
}

/* --- One question ------------------------------------------------------ */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastGeminiAt = 0;

/** Stays under the free tier's per-minute quota, which is per model. Returns the time waited. */
async function paceGemini(): Promise<number> {
  const wait = Math.max(0, lastGeminiAt + delayMs - Date.now());
  if (wait > 0) await sleep(wait);
  lastGeminiAt = Date.now();
  return wait;
}

class DailyQuotaSpent extends Error {}

/** Waits out a spent per-minute quota. A spent daily quota ends the run, with what it has. */
async function withQuotaRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (isDailyQuotaError(error)) throw new DailyQuotaSpent();
      if (!(error instanceof ProviderError) || !error.retryable || attempt >= 3) throw error;
      const wait = error.status === 429 ? (error.retryAfterMs ?? 60_000) + 2000 : 5000;
      console.log(
        `   ${error.provider} ${error.status ?? "network"}: waiting ${Math.round(wait / 1000)}s`,
      );
      await sleep(wait);
    }
  }
}

async function runQuestion(
  db: ReturnType<typeof createDb>["db"],
  userId: string,
  sources: Map<string, SeededSource>,
  question: EvalQuestion,
): Promise<QuestionResult> {
  const started = Date.now();
  const scope = question.scope.map((key) => sources.get(key)!);
  const keyByVersion = new Map(scope.map((source) => [source.versionId, source.key]));
  const locate = (passage: Pick<Passage, "versionId" | "pageStart" | "pageEnd">): Located => ({
    document: keyByVersion.get(passage.versionId) ?? "unknown",
    pageStart: passage.pageStart,
    pageEnd: passage.pageEnd,
  });

  const retrieval = await withQuotaRetry(() =>
    retrieve(
      {
        db,
        jina,
        redis: null,
        cacheKeys: cacheKeys("test"),
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimension: EMBEDDING_DIMENSION,
      },
      {
        userId,
        question: question.question,
        sources: scope.map(({ versionId, documentId, title }) => ({
          versionId,
          documentId,
          title,
        })),
      },
    ),
  );
  const retrievalMs = Date.now() - started;

  // What each mode would have sent to the model: the same number of passages.
  const byChunk = new Map(retrieval.ranked.map((passage) => [passage.chunkId, passage]));
  const inOrder = (hits: readonly { chunkId: string }[]) =>
    hits.flatMap((hit) => {
      const passage = byChunk.get(hit.chunkId);
      return passage ? [{ ...passage, score: null }] : [];
    });
  const embeddingOnly = selectPassages(inOrder(retrieval.search.vector)).map(locate);
  const fusion = selectPassages(inOrder(retrieval.search.merged)).map(locate);
  const reranked = retrieval.passages.map(locate);
  const rerankedOrder = retrieval.ranked.map(locate);

  const abstainedBeforeModel = shouldAbstain(retrieval.metadata, abstainScore);
  let costUsd = estimateJinaCost(
    retrieval.metadata.tokens.embedding + retrieval.metadata.tokens.rerank,
  );
  let answer: GeneratedAnswer | null = null;
  let firstTokenMs: number | null = null;
  // Waiting for the free tier's quota isn't part of how long an answer takes.
  let paced = 0;

  if (gemini) {
    if (abstainedBeforeModel) {
      answer = {
        body: "",
        abstained: true,
        citations: [],
        claims: 0,
        unsupportedClaims: 0,
        unknownLabels: 0,
      };
    } else {
      paced = await paceGemini();
      const passages = labelPassages(retrieval.passages);
      const result = await withQuotaRetry(async () => {
        const stream = streamAnswer(
          { gemini, model: ANSWER_MODEL },
          {
            question: question.question,
            passages,
            sourceCount: new Set(passages.map((passage) => passage.versionId)).size,
          },
        );
        for (;;) {
          const next = await stream.next();
          if (next.done) return next.value;
        }
      });
      firstTokenMs = result.firstTokenMs;
      if (result.end) costUsd += estimateGeminiCost(result.end.model, result.end.usage);
      const mapped = result.insufficient
        ? { body: result.text, citations: [], unknownLabels: [] }
        : mapCitations(result.text, passages);
      const support =
        mapped.citations.length > 0
          ? await checkSupport({ gemini, model: FAST_MODEL }, { body: mapped.body, passages })
          : null;
      if (support) costUsd += estimateGeminiCost(support.run.model, support.run.usage);
      answer = {
        body: mapped.body,
        abstained: result.insufficient,
        citations: mapped.citations.map(locate),
        claims: support?.run.status === "succeeded" ? support.claims : 0,
        unsupportedClaims: support?.unsupportedClaims ?? 0,
        unknownLabels: mapped.unknownLabels.length,
        checkFailed: support?.run.status === "failed",
      };
    }
  }

  return {
    question,
    retrieval: { embeddingOnly, fusion, reranked, rerankedOrder },
    topScore: retrieval.metadata.topScore,
    abstainedBeforeModel,
    timings: { retrievalMs, firstTokenMs, totalMs: Date.now() - started - paced },
    costUsd,
    answer,
    error: null,
  };
}

/* --- The report -------------------------------------------------------- */

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const ms = (value: number | null) => (value === null ? "n/a" : `${Math.round(value)} ms`);

function printReport(results: QuestionResult[]) {
  const summary = summarize(results);
  console.log("\nRetrieval: are the expected pages found, and how high?");
  console.log("  mode             source hit   page in sent   page @3      page @1");
  for (const [name, score] of [
    ["embedding only", summary.retrieval.embeddingOnly],
    ["fusion (RRF)", summary.retrieval.fusion],
    ["reranked", summary.retrieval.reranked],
  ] as const) {
    console.log(
      `  ${name.padEnd(16)} ${pct(score.sourceHitRate).padEnd(12)} ${pct(score.pageHitRate).padEnd(14)} ${pct(score.pageHitAt3).padEnd(12)} ${pct(score.pageHitAt1)}`,
    );
  }

  const answerableScores = results
    .filter((result) => result.question.answerable && result.topScore !== null)
    .map((result) => result.topScore!)
    .sort((a, b) => a - b);
  const unanswerableScores = results
    .filter((result) => !result.question.answerable && result.topScore !== null)
    .map((result) => result.topScore!)
    .sort((a, b) => a - b);
  console.log("\nTop rerank scores:");
  console.log(`  answerable   ${answerableScores.map((score) => score.toFixed(2)).join(" ")}`);
  console.log(`  unanswerable ${unanswerableScores.map((score) => score.toFixed(2)).join(" ")}`);
  const suggested = suggestThreshold(results);
  if (suggested) {
    console.log(
      `  suggested threshold ${suggested.threshold.toFixed(3)} (${suggested.falseAbstentions} false, ${suggested.missedAbstentions} missed); in use ${abstainScore}`,
    );
  }
  const misses = results
    .filter(
      (result) =>
        result.question.answerable &&
        result.question.expected.length > 0 &&
        !result.question.expected.every((want) =>
          result.retrieval.reranked.some(
            (item) =>
              item.document === want.document &&
              want.pages.some((page) => item.pageStart <= page && page <= item.pageEnd),
          ),
        ),
    )
    .map((result) => result.question.id);
  if (misses.length > 0) console.log(`  page misses after reranking: ${misses.join(", ")}`);

  if (summary.answers.answered > 0) {
    const { answers } = summary;
    console.log("\nAnswers:");
    console.log(`  answered                 ${answers.answered} of ${summary.questions}`);
    console.log(`  correct page citations   ${pct(answers.correctPageCitationRate)}`);
    console.log(`  expected source cited    ${pct(answers.expectedSourceCitedRate)}`);
    console.log(`  expected facts stated    ${pct(answers.factRate)}`);
    console.log(`  unsupported claims       ${pct(answers.unsupportedClaimRate)}`);
    console.log(`  citation checks failed   ${answers.failedChecks}`);
    console.log(`  invented citation labels ${answers.inventedLabels}`);
    console.log(`  abstention accuracy      ${pct(answers.abstentionAccuracy)}`);
    if (answers.falseAbstentions.length > 0) {
      console.log(`    false abstentions: ${answers.falseAbstentions.join(", ")}`);
    }
    if (answers.missedAbstentions.length > 0) {
      console.log(`    answered anyway:   ${answers.missedAbstentions.join(", ")}`);
    }
    console.log(`  adversarial pass rate    ${pct(answers.adversarialPassRate)}`);
    if (answers.adversarialFailures.length > 0) {
      console.log(`    failed: ${answers.adversarialFailures.join(", ")}`);
    }
  }

  console.log("\nLatency (p50 / p95):");
  console.log(
    `  retrieval    ${ms(summary.latency.retrievalP50)} / ${ms(summary.latency.retrievalP95)}`,
  );
  console.log(
    `  first token  ${ms(summary.latency.firstTokenP50)} / ${ms(summary.latency.firstTokenP95)}`,
  );
  console.log(`  whole turn   ${ms(summary.latency.totalP50)} / ${ms(summary.latency.totalP95)}`);
  console.log(
    `\nEstimated cost at paid rates: $${summary.cost.totalUsd.toFixed(4)} total, $${(summary.cost.perQuestionUsd ?? 0).toFixed(5)} per question`,
  );
  if (summary.errors > 0) console.log(`\n${summary.errors} questions failed with provider errors.`);
  return summary;
}

/* --- Run --------------------------------------------------------------- */

const selected = EVAL_QUESTIONS.filter(
  (question) =>
    (!args.kind || question.kind === args.kind) && (!args.only || question.id === args.only),
).slice(0, args.limit ? Number(args.limit) : undefined);

for (const question of selected) {
  for (const key of question.scope) documentByKey(key);
}

await freshDatabase();
const connection = createDb({ url: DATABASE_URL, role: "script" });
const results: QuestionResult[] = [];
try {
  const [user] = await connection.db
    .insert(users)
    .values({
      auth0Sub: `eval|${randomUUID()}`,
      email: "eval@example.invalid",
      emailVerified: true,
      displayName: "Evaluation",
    })
    .returning({ id: users.id });
  const { sources, chunkCount } = await seed(connection.db, user!.id);
  console.log(
    `${EVAL_DOCUMENTS.length} documents, ${chunkCount} chunks. ${selected.length} questions, ` +
      (gemini ? `${ANSWER_MODEL} (${ANSWER_SETTINGS.thinking} thinking)` : "retrieval only") +
      ".\n",
  );
  for (const [index, question] of selected.entries()) {
    try {
      const result = await runQuestion(connection.db, user!.id, sources, question);
      results.push(result);
      const outcome = result.answer
        ? result.answer.abstained
          ? "abstained"
          : `${result.answer.citations.length} citations`
        : result.abstainedBeforeModel
          ? "would abstain"
          : "would answer";
      console.log(
        `${String(index + 1).padStart(2)}. ${question.id.padEnd(28)} top ${(result.topScore ?? 0).toFixed(2).padStart(5)}  ${outcome}`,
      );
    } catch (error) {
      if (error instanceof DailyQuotaSpent) {
        const left = selected.length - index;
        console.log(
          `\n${ANSWER_MODEL} has no free requests left today. Stopping with ${left} questions unasked; the report covers the rest.`,
        );
        break;
      }
      const message = error instanceof Error ? error.message.slice(0, 160) : "unknown";
      console.log(`${String(index + 1).padStart(2)}. ${question.id.padEnd(28)} failed: ${message}`);
      results.push({
        question,
        retrieval: { embeddingOnly: [], fusion: [], reranked: [], rerankedOrder: [] },
        topScore: null,
        abstainedBeforeModel: false,
        timings: { retrievalMs: 0, firstTokenMs: null, totalMs: 0 },
        costUsd: 0,
        answer: null,
        error: message,
      });
    }
  }
  const summary = printReport(results);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ summary, results }, null, 2));
    console.log(`\nPer-question results: ${args.json}`);
  }
} finally {
  await connection.close();
}
