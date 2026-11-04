import {
  EVENT_NAMES,
  isTerminalJobStatus,
  JOB_ERROR_MESSAGES,
  jobErrorMessage,
  JOB_PHASE_LABELS,
  JOB_PHASES,
  PERMANENT_JOB_ERRORS,
  type JobErrorCode,
  type JobPhase,
  type JobProgress,
  type JobStatusResponse,
} from "@foliomind/contracts";
import { documents, documentVersions, jobs, urlImports, type Executor } from "@foliomind/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { enqueue } from "../outbox";

/*
 * Job state transitions (blueprint Section 9): queued → running →
 * succeeded/failed/cancelled, with the current phase, a small progress object,
 * the attempt count, a safe error code and the Inngest IDs. Every delayed step
 * calls `assertJobCanContinue` before writing, so a cancelled job or a deleted
 * document is never written to or resurrected.
 */

/** Raised when a job must stop: cancelled by its owner, or its document was deleted. */
export class JobStopped extends Error {
  constructor(readonly reason: "cancelled" | "deleted" | "missing") {
    super(reason);
    this.name = "JobStopped";
  }
}

export interface JobRow {
  id: string;
  ownerId: string | null;
  kind: string;
  targetId: string | null;
  status: string;
  phase: string;
  cancelRequested: boolean;
  safeErrorCode: string | null;
}

export async function getJob(db: Executor, jobId: string): Promise<JobRow | null> {
  const [job] = await db
    .select({
      id: jobs.id,
      ownerId: jobs.ownerId,
      kind: jobs.kind,
      targetId: jobs.targetId,
      status: jobs.status,
      phase: jobs.phase,
      cancelRequested: jobs.cancelRequested,
      safeErrorCode: jobs.safeErrorCode,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return job ?? null;
}

/**
 * Throws `JobStopped` unless the job is still live and its document active.
 * Call it at the start of every step that writes results.
 */
export async function assertJobCanContinue(
  db: Executor,
  jobId: string,
  documentId: string,
): Promise<void> {
  const [row] = await db
    .select({
      status: jobs.status,
      cancelRequested: jobs.cancelRequested,
      documentStatus: documents.status,
    })
    .from(jobs)
    .leftJoin(documents, eq(documents.id, documentId))
    .where(eq(jobs.id, jobId));
  if (!row) throw new JobStopped("missing");
  if (row.documentStatus !== "active") throw new JobStopped("deleted");
  if (row.cancelRequested || row.status === "cancelled") throw new JobStopped("cancelled");
  if (isTerminalJobStatus(row.status)) throw new JobStopped("cancelled");
}

export interface RunRef {
  runId?: string | undefined;
  eventId?: string | undefined;
  /** Zero-based Inngest attempt of the current step. */
  attempt?: number | undefined;
}

/** Marks the job running in `phase`; never moves a finished job back. */
export async function markJobPhase(
  db: Executor,
  jobId: string,
  phase: JobPhase,
  { progress, run }: { progress?: JobProgress; run?: RunRef } = {},
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "running",
      phase,
      ...(progress ? { progress } : {}),
      ...(run?.runId ? { inngestRunId: run.runId } : {}),
      ...(run?.eventId ? { inngestEventId: run.eventId } : {}),
      ...(run?.attempt !== undefined
        ? { attempts: sql`greatest(${jobs.attempts}, ${run.attempt + 1})` }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])));
}

export async function updateJobProgress(
  db: Executor,
  jobId: string,
  progress: JobProgress,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      progress: sql`coalesce(${jobs.progress}, '{}'::jsonb) || ${JSON.stringify(progress)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));
}

export async function succeedJob(
  db: Executor,
  jobId: string,
  result: Record<string, unknown> = {},
): Promise<boolean> {
  const updated = await db
    .update(jobs)
    .set({
      status: "succeeded",
      phase: "done",
      safeErrorCode: null,
      result,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])))
    .returning({ id: jobs.id });
  return updated.length > 0;
}

/** A stopped run (cancelled by its owner, or its document deleted) ends `cancelled`. */
export async function stopJob(db: Executor, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "cancelled", safeErrorCode: "cancelled", updatedAt: sql`now()` })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])));
}

/** Marks a live job failed. Returns false when it had already finished (e.g. cancelled). */
export async function failJob(db: Executor, jobId: string, code: JobErrorCode): Promise<boolean> {
  const updated = await db
    .update(jobs)
    .set({ status: "failed", safeErrorCode: code, updatedAt: sql`now()` })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])))
    .returning({ id: jobs.id });
  return updated.length > 0;
}

/**
 * Reads a failure as one of the safe codes. Job failures carry the code as
 * their message (`JobFailure`); provider errors that exhausted their retries
 * read as `provider_unavailable`; anything else is `internal`.
 */
export function jobErrorCodeFrom(
  error: { name?: string | undefined; message?: string | undefined } | undefined,
): JobErrorCode {
  const code = (error?.message ?? "").split(":")[0]?.trim() ?? "";
  if (Object.hasOwn(JOB_ERROR_MESSAGES, code)) return code as JobErrorCode;
  if (error?.name === "ProviderError" || error?.name === "RetryAfterError") {
    return "provider_unavailable";
  }
  return "internal";
}

/** A failure with a safe code as its message, so onFailure can recover the code. */
export class JobFailure extends Error {
  constructor(readonly code: JobErrorCode) {
    super(code);
    this.name = "JobFailure";
  }
}

/* --- Owner-facing status, cancel and retry --------------------------------- */

const asPhase = (value: string): JobPhase =>
  (JOB_PHASES as readonly string[]).includes(value) ? (value as JobPhase) : "queued";

export function canRetryJob(job: { status: string; safeErrorCode: string | null }): boolean {
  if (job.status !== "failed" && job.status !== "cancelled") return false;
  return !(PERMANENT_JOB_ERRORS as readonly string[]).includes(job.safeErrorCode ?? "");
}

/** The document a job belongs to (an ingested version's document, or an import's). */
async function jobDocumentId(db: Executor, job: JobRow): Promise<string | null> {
  if (!job.targetId) return null;
  if (job.kind === "import-url") return job.targetId;
  const [version] = await db
    .select({ documentId: documentVersions.documentId })
    .from(documentVersions)
    .where(eq(documentVersions.id, job.targetId));
  return version?.documentId ?? null;
}

/** `GET /api/jobs/:id`: the owner's view, or null for anyone else (404). */
export async function jobStatusForOwner(
  db: Executor,
  ownerId: string,
  jobId: string,
): Promise<JobStatusResponse | null> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.ownerId, ownerId)));
  if (!job || (job.kind !== "ingest-document" && job.kind !== "import-url")) return null;
  const documentId = await jobDocumentId(db, job);
  const phase = asPhase(job.phase);
  const errorCode = (job.safeErrorCode as JobErrorCode | null) ?? null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status as JobStatusResponse["status"],
    phase,
    phaseLabel: JOB_PHASE_LABELS[phase],
    progress: (job.progress as JobProgress | null) ?? {},
    errorCode,
    errorMessage: jobErrorMessage(errorCode),
    canRetry: canRetryJob(job),
    canCancel: !isTerminalJobStatus(job.status),
    documentId,
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * The owner cancels a live job (Section 9): the job is marked cancelled at once,
 * the version (or import) is marked failed, and the cancellation event is
 * enqueued so the running function stops between steps. Returns the outbox
 * key to deliver after commit, or null when there was nothing to cancel.
 */
export async function requestJobCancel(
  db: Executor,
  ownerId: string,
  jobId: string,
): Promise<{ eventKey: string } | null> {
  const [job] = await db
    .update(jobs)
    .set({
      cancelRequested: true,
      status: "cancelled",
      safeErrorCode: "cancelled",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.ownerId, ownerId),
        inArray(jobs.status, ["queued", "running"]),
        inArray(jobs.kind, ["ingest-document", "import-url"]),
      ),
    )
    .returning({
      id: jobs.id,
      kind: jobs.kind,
      targetId: jobs.targetId,
      operationKey: jobs.operationKey,
    });
  if (!job) return null;

  if (job.kind === "ingest-document" && job.targetId) {
    await db
      .update(documentVersions)
      .set({ status: "failed" })
      .where(
        and(
          eq(documentVersions.id, job.targetId),
          inArray(documentVersions.status, ["uploaded", "queued", "extracting", "embedding"]),
        ),
      );
  }
  if (job.kind === "import-url") {
    await db
      .update(urlImports)
      .set({ status: "failed", safeErrorCode: "cancelled" })
      .where(and(eq(urlImports.jobId, job.id), sql`${urlImports.status} <> 'ready'`));
  }
  const eventKey = `cancel:${job.id}`;
  await enqueue(db, {
    key: eventKey,
    name: EVENT_NAMES.documentVersionCancelled,
    data: { jobId: job.id, ownerId, operationKey: job.operationKey },
  });
  return { eventKey };
}
