import { EVENT_NAMES } from "@foliomind/contracts";
import { documents, documentVersions, jobs, type Database, type Executor } from "@foliomind/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { requestReimport, type ImportRequestResult } from "../imports";
import { canRetryJob } from "../jobs";
import { enqueue } from "../outbox";

/*
 * Document processing as the owner sees it: the latest job behind a document
 * (its import, then its ingestion) and Retry (Section 11: `POST
 * /api/documents/:id/retry`). Retry re-sends work only after a terminal
 * failure, with a new operation key and a new job, so nothing is charged or
 * indexed twice.
 */

export interface LatestJob {
  id: string;
  kind: string;
  status: string;
  phase: string;
  safeErrorCode: string | null;
  targetId: string | null;
}

/** Latest import or ingestion job of each document, for My Library cards. */
export async function latestJobs(
  db: Executor,
  ownerId: string,
  documentIds: readonly string[],
): Promise<Map<string, LatestJob>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db.execute<{
    document_id: string;
    id: string;
    kind: string;
    status: string;
    phase: string;
    safe_error_code: string | null;
    target_id: string | null;
  }>(sql`
    select distinct on (document_id) document_id, id, kind, status, phase,
      safe_error_code, target_id
    from (
      select j.*, coalesce(v.document_id, j.target_id) as document_id
      from jobs j
      left join document_versions v on j.kind = 'ingest-document' and v.id = j.target_id
      where j.owner_id = ${ownerId}
        and j.kind in ('ingest-document', 'import-url')
        and (
          (j.kind = 'import-url' and j.target_id in (${sql.join(
            documentIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))
          or (j.kind = 'ingest-document' and v.document_id in (${sql.join(
            documentIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))
        )
    ) latest
    order by document_id, created_at desc, id desc`);
  return new Map(
    rows.map((row) => [
      row.document_id,
      {
        id: row.id,
        kind: row.kind,
        status: row.status,
        phase: row.phase,
        safeErrorCode: row.safe_error_code,
        targetId: row.target_id,
      },
    ]),
  );
}

export type RetryResult =
  | { ok: true; jobId: string; eventKey: string }
  | { ok: false; code: "not_found" | "not_retryable" | ImportRefusalCode };

type ImportRefusalCode = Extract<ImportRequestResult, { ok: false }>["code"];

/** Retry the document's last failed step: its import, or its ingestion. */
export async function retryDocument(
  db: Database,
  input: { userId: string; documentId: string },
): Promise<RetryResult> {
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.ownerId, input.userId),
        eq(documents.status, "active"),
      ),
    );
  if (!document) return { ok: false, code: "not_found" };
  const latest = (await latestJobs(db, input.userId, [input.documentId])).get(input.documentId);
  if (!latest || !canRetryJob(latest)) return { ok: false, code: "not_retryable" };

  if (latest.kind === "import-url") {
    const result = await requestReimport(db, input);
    return result.ok
      ? { ok: true, jobId: result.jobId, eventKey: result.eventKey }
      : { ok: false, code: result.code };
  }

  const versionId = latest.targetId;
  if (!versionId) return { ok: false, code: "not_retryable" };
  return db.transaction(async (tx) => {
    const [version] = await tx
      .update(documentVersions)
      .set({ status: "queued", updatedAt: sql`now()` })
      .where(and(eq(documentVersions.id, versionId), eq(documentVersions.status, "failed")))
      .returning({ id: documentVersions.id });
    if (!version) return { ok: false, code: "not_retryable" } as const;
    const [{ attempts } = { attempts: 0 }] = await tx
      .select({ attempts: sql<number>`count(*)::int`.mapWith(Number) })
      .from(jobs)
      .where(and(eq(jobs.kind, "ingest-document"), eq(jobs.targetId, versionId)));
    const operationKey = `ingest-document:${versionId}:retry-${attempts}`;
    const [job] = await tx
      .insert(jobs)
      .values({
        ownerId: input.userId,
        kind: "ingest-document",
        targetId: versionId,
        operationKey,
      })
      .returning({ id: jobs.id });
    if (!job) throw new Error("Retry job was not created");
    await enqueue(tx, {
      key: operationKey,
      name: EVENT_NAMES.documentVersionUploaded,
      data: {
        documentId: input.documentId,
        versionId,
        ownerId: input.userId,
        jobId: job.id,
        operationKey,
      },
    });
    return { ok: true, jobId: job.id, eventKey: operationKey } as const;
  });
}

/** Live jobs of a document (cancel from the library card). */
export async function liveJobIds(db: Executor, ownerId: string, documentId: string) {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .leftJoin(documentVersions, eq(documentVersions.id, jobs.targetId))
    .where(
      and(
        eq(jobs.ownerId, ownerId),
        inArray(jobs.status, ["queued", "running"]),
        or(
          and(eq(jobs.kind, "import-url"), eq(jobs.targetId, documentId)),
          and(eq(jobs.kind, "ingest-document"), eq(documentVersions.documentId, documentId)),
        ),
      ),
    )
    .orderBy(desc(jobs.createdAt));
  return rows.map((row) => row.id);
}

/**
 * Ingestion jobs that never started (no Inngest run) and are older than
 * `olderThan` get a fresh job and outbox event under a new operation key; the
 * stale job is cancelled. Used once when Worker A first goes live (events sent
 * before any worker existed were never consumed) and safe to run again.
 * Returns the outbox keys to deliver.
 */
export async function requeueStalledIngestion(
  db: Database,
  { olderThan = new Date(Date.now() - 15 * 60 * 1000), limit = 200 } = {},
): Promise<string[]> {
  const stalled = await db
    .select({
      jobId: jobs.id,
      ownerId: jobs.ownerId,
      versionId: jobs.targetId,
      documentId: documentVersions.documentId,
    })
    .from(jobs)
    .innerJoin(documentVersions, eq(documentVersions.id, jobs.targetId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(jobs.kind, "ingest-document"),
        eq(jobs.status, "queued"),
        sql`${jobs.inngestRunId} is null`,
        sql`${jobs.createdAt} < ${olderThan.toISOString()}`,
        inArray(documentVersions.status, ["uploaded", "queued"]),
        eq(documents.status, "active"),
      ),
    )
    .limit(limit);

  const keys: string[] = [];
  for (const row of stalled) {
    if (!row.ownerId || !row.versionId) continue;
    const key = await db.transaction(async (tx) => {
      const [stopped] = await tx
        .update(jobs)
        .set({ status: "cancelled", safeErrorCode: "cancelled", updatedAt: sql`now()` })
        .where(and(eq(jobs.id, row.jobId), eq(jobs.status, "queued")))
        .returning({ id: jobs.id });
      if (!stopped) return null;
      const operationKey = `ingest-document:${row.versionId}:requeue-${row.jobId.slice(0, 8)}`;
      const [job] = await tx
        .insert(jobs)
        .values({
          ownerId: row.ownerId,
          kind: "ingest-document",
          targetId: row.versionId,
          operationKey,
        })
        .returning({ id: jobs.id });
      await enqueue(tx, {
        key: operationKey,
        name: EVENT_NAMES.documentVersionUploaded,
        data: {
          documentId: row.documentId,
          versionId: row.versionId!,
          ownerId: row.ownerId!,
          jobId: job!.id,
          operationKey,
        },
      });
      return operationKey;
    });
    if (key) keys.push(key);
  }
  return keys;
}
