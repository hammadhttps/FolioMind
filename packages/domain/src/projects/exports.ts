import { randomUUID } from "node:crypto";
import {
  EVENT_NAMES,
  jobErrorMessage,
  projectTemplateVersion,
  readProjectDoc,
  revisionSourceSchema,
  templateFromVersion,
  type JobErrorCode,
  type ProjectDoc,
  type ProjectExportView,
  type ProjectMode,
  type ProjectRefusal,
  type ProjectSettings,
  type ProjectTemplate,
  type RevisionSource,
} from "@foliomind/contracts";
import {
  assets,
  exports as projectExports,
  jobs,
  projectRevisions,
  projects,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../access";
import { currentEntitlement } from "../entitlements";
import { failJob, succeedJob } from "../jobs";
import { enqueue } from "../outbox";
import { release, reserve, storageBytesUsed } from "../usage";
import { reexportKey } from "./generation";
import { getOwnedProject, liveProjectJob, toProjectRecord } from "./records";

/*
 * Exports (blueprint Sections 6, 8, 10 and 26): always of one exact, immutable
 * revision. A project's first export comes with it; exporting a revision whose
 * text has changed since an earlier export spends a re-export. Exporting the
 * same revision again in the same template hands back the file it already has.
 */

const EXPORT_RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;

export type ExportCharge = "none" | "reexport";

/** Whether this revision would spend a re-export: edited text, after an earlier export. */
export async function exportChargeFor(
  db: Executor,
  projectId: string,
  revisionId: string,
): Promise<ExportCharge> {
  const rows = await db
    .select({ revisionId: projectExports.projectRevisionId })
    .from(projectExports)
    .innerJoin(projectRevisions, eq(projectRevisions.id, projectExports.projectRevisionId))
    .where(and(eq(projectRevisions.projectId, projectId), ne(projectExports.status, "failed")));
  if (rows.length === 0 || rows.some((row) => row.revisionId === revisionId)) return "none";
  return "reexport";
}

export type ExportOutcome =
  | { ok: true; exportId: string; jobId: string; eventKey: string; reused: false }
  | { ok: true; exportId: string; reused: true }
  | { ok: false; code: ProjectRefusal };

class Refused extends Error {
  constructor(readonly code: ProjectRefusal) {
    super(code);
  }
}

export async function requestProjectExport(
  db: Database,
  actor: Actor,
  projectId: string,
  revisionId: string,
  now: Date = new Date(),
): Promise<ExportOutcome> {
  if (actor.status !== "active") return { ok: false, code: "account_inactive" };
  const project = await getOwnedProject(db, actor, projectId);
  if (!project) return { ok: false, code: "not_found" };
  if (project.archivedAt) return { ok: false, code: "archived" };
  if (await liveProjectJob(db, projectId)) return { ok: false, code: "busy" };

  const [revision] = await db
    .select({ id: projectRevisions.id })
    .from(projectRevisions)
    .where(and(eq(projectRevisions.id, revisionId), eq(projectRevisions.projectId, projectId)));
  if (!revision) return { ok: false, code: "no_revision" };

  const templateVersion = projectTemplateVersion(project.templateKey);
  const [existing] = await db
    .select({ id: projectExports.id })
    .from(projectExports)
    .where(
      and(
        eq(projectExports.projectRevisionId, revisionId),
        eq(projectExports.templateVersion, templateVersion),
        eq(projectExports.status, "ready"),
      ),
    );
  if (existing) return { ok: true, exportId: existing.id, reused: true };

  const { limits } = await currentEntitlement(db, actor.id, now);
  if ((await storageBytesUsed(db, actor.id)) >= limits.storageBytes) {
    return { ok: false, code: "storage_limit" };
  }

  const jobId = randomUUID();
  const exportId = randomUUID();
  const charge = await exportChargeFor(db, projectId, revisionId);
  const usageKey = charge === "reexport" ? reexportKey(jobId) : null;
  if (usageKey) {
    const reserved = await reserve(db, {
      userId: actor.id,
      metric: "reexports",
      quantity: 1,
      operationKey: usageKey,
      expiresAt: new Date(now.getTime() + EXPORT_RESERVATION_TTL_MS),
      now,
    });
    if (!reserved.ok) return { ok: false, code: "quota_reexports" };
  }

  const operationKey = `render-export:${jobId}`;
  try {
    await db.transaction(async (tx) => {
      const locked = await getOwnedProject(tx, actor, projectId, { lock: true });
      if (!locked) throw new Refused("not_found");
      if (await liveProjectJob(tx, projectId)) throw new Refused("busy");
      await tx.insert(jobs).values({
        id: jobId,
        ownerId: actor.id,
        kind: "render-export",
        targetId: projectId,
        operationKey,
      });
      await tx.insert(projectExports).values({
        id: exportId,
        projectRevisionId: revisionId,
        jobId,
        templateVersion,
        status: "queued",
        operationKey,
      });
      await tx
        .update(projects)
        .set({ status: "rendering", updatedAt: sql`now()` })
        .where(eq(projects.id, projectId));
      await enqueue(tx, {
        key: operationKey,
        name: EVENT_NAMES.projectExportRequested,
        data: {
          projectId,
          ownerId: actor.id,
          jobId,
          exportId,
          revisionId,
          operationKey,
          usageKey,
        },
      });
    });
  } catch (error) {
    if (usageKey) await release(db, usageKey);
    if (error instanceof Refused) return { ok: false, code: error.code };
    throw error;
  }
  return { ok: true, exportId, jobId, eventKey: operationKey, reused: false };
}

export interface ExportContext {
  title: string;
  mode: ProjectMode;
  settings: ProjectSettings;
  template: ProjectTemplate;
  templateVersion: string;
  revisionNo: number;
  content: ProjectDoc;
  sources: RevisionSource[];
}

const revisionSources = z.array(revisionSourceSchema).catch([]);

/** The exact revision and template this export asked for; never the editor's current text. */
export async function loadExportContext(
  db: Executor,
  input: { exportId: string; ownerId: string; revisionId: string },
): Promise<ExportContext | null> {
  const [row] = await db
    .select({ export: projectExports, revision: projectRevisions, project: projects })
    .from(projectExports)
    .innerJoin(projectRevisions, eq(projectRevisions.id, projectExports.projectRevisionId))
    .innerJoin(projects, eq(projects.id, projectRevisions.projectId))
    .where(
      and(
        eq(projectExports.id, input.exportId),
        eq(projectExports.projectRevisionId, input.revisionId),
        eq(projects.ownerId, input.ownerId),
        isNull(projects.deletedAt),
      ),
    );
  if (!row) return null;
  const project = toProjectRecord(row.project);
  return {
    title: project.title,
    mode: project.mode,
    settings: project.settings,
    template: templateFromVersion(row.export.templateVersion),
    templateVersion: row.export.templateVersion,
    revisionNo: row.revision.revisionNo,
    content: readProjectDoc(row.revision.content),
    sources: revisionSources.parse(row.revision.sourceSnapshot),
  };
}

export async function markExportRendering(db: Executor, exportId: string): Promise<void> {
  await db
    .update(projectExports)
    .set({ status: "rendering", updatedAt: sql`now()` })
    .where(and(eq(projectExports.id, exportId), eq(projectExports.status, "queued")));
}

export const exportCustomId = (operationKey: string) => `export:${operationKey}`;

/**
 * The file is stored: the asset, the export and the job finish together. Over
 * the storage limit it refuses and returns false, and the caller removes the
 * file (storage includes generated exports, Section 10).
 */
export async function completeExport(
  db: Database,
  input: {
    exportId: string;
    jobId: string;
    projectId: string;
    ownerId: string;
    operationKey: string;
    file: { key: string; size: number };
    checksum: string;
    pageCount: number;
    acl: "public" | "private";
    metrics: Record<string, number>;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const { limits } = await currentEntitlement(tx, input.ownerId);
    if ((await storageBytesUsed(tx, input.ownerId)) + input.file.size > limits.storageBytes) {
      return false;
    }
    const customId = exportCustomId(input.operationKey);
    await tx
      .insert(assets)
      .values({
        ownerId: input.ownerId,
        fileKey: input.file.key,
        customId,
        fileRoute: "projectExport",
        acl: input.acl,
        purpose: "export",
        bytes: input.file.size,
        mimeType: "application/pdf",
        checksum: input.checksum,
        state: "ready",
      })
      .onConflictDoNothing({ target: assets.customId });
    const [asset] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.customId, customId));
    await tx
      .update(projectExports)
      .set({
        assetId: asset?.id ?? null,
        pageCount: input.pageCount,
        status: "ready",
        updatedAt: sql`now()`,
      })
      .where(eq(projectExports.id, input.exportId));
    await tx
      .update(projects)
      .set({ status: "complete", updatedAt: sql`now()` })
      .where(and(eq(projects.id, input.projectId), eq(projects.status, "rendering")));
    await succeedJob(tx, input.jobId, input.metrics);
    return true;
  });
}

/** The export failed: its job and row say so, the charge returns and editing carries on. */
export async function failExport(
  db: Database,
  input: {
    exportId: string;
    jobId: string;
    projectId: string;
    usageKey: string | null;
    code: JobErrorCode;
  },
): Promise<boolean> {
  const failed = await failJob(db, input.jobId, input.code);
  if (input.usageKey) await release(db, input.usageKey);
  await db
    .update(projectExports)
    .set({ status: "failed", updatedAt: sql`now()` })
    .where(eq(projectExports.id, input.exportId));
  if (failed) {
    await db
      .update(projects)
      .set({ status: "failed", updatedAt: sql`now()` })
      .where(and(eq(projects.id, input.projectId), eq(projects.status, "rendering")));
  }
  return failed;
}

export async function listProjectExports(
  db: Executor,
  projectId: string,
  limit = 10,
): Promise<ProjectExportView[]> {
  const rows = await db
    .select({
      id: projectExports.id,
      revisionId: projectExports.projectRevisionId,
      revisionNo: projectRevisions.revisionNo,
      templateVersion: projectExports.templateVersion,
      status: projectExports.status,
      pageCount: projectExports.pageCount,
      bytes: assets.bytes,
      assetState: assets.state,
      createdAt: projectExports.createdAt,
      errorCode: jobs.safeErrorCode,
    })
    .from(projectExports)
    .innerJoin(projectRevisions, eq(projectRevisions.id, projectExports.projectRevisionId))
    .innerJoin(jobs, eq(jobs.id, projectExports.jobId))
    .leftJoin(assets, eq(assets.id, projectExports.assetId))
    .where(eq(projectRevisions.projectId, projectId))
    .orderBy(desc(projectExports.createdAt), desc(projectExports.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    revisionId: row.revisionId,
    revisionNo: row.revisionNo,
    template: templateFromVersion(row.templateVersion),
    status: row.status as ProjectExportView["status"],
    pageCount: row.pageCount,
    bytes: row.bytes,
    createdAt: row.createdAt.toISOString(),
    errorMessage: row.status === "failed" ? jobErrorMessage(row.errorCode) : null,
  }));
}

export interface DownloadableExport {
  fileKey: string;
  title: string;
  bytes: number;
}

/** Download (Section 6 step 8): access is checked on every request, and only the owner has any. */
export async function getDownloadableExport(
  db: Executor,
  actor: Actor,
  exportId: string,
): Promise<DownloadableExport | null> {
  if (actor.status !== "active") return null;
  const [row] = await db
    .select({ fileKey: assets.fileKey, title: projects.title, bytes: assets.bytes })
    .from(projectExports)
    .innerJoin(projectRevisions, eq(projectRevisions.id, projectExports.projectRevisionId))
    .innerJoin(projects, eq(projects.id, projectRevisions.projectId))
    .innerJoin(assets, eq(assets.id, projectExports.assetId))
    .where(
      and(
        eq(projectExports.id, exportId),
        eq(projectExports.status, "ready"),
        eq(projects.ownerId, actor.id),
        isNull(projects.deletedAt),
        eq(assets.state, "ready"),
      ),
    );
  return row ?? null;
}

/** Removes the output safely (Section 11): the record goes now, its file with the next cleanup. */
export async function deleteProjectExport(
  db: Database,
  actor: Actor,
  exportId: string,
): Promise<boolean> {
  if (actor.status !== "active") return false;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ assetId: projectExports.assetId, status: projectExports.status })
      .from(projectExports)
      .innerJoin(projectRevisions, eq(projectRevisions.id, projectExports.projectRevisionId))
      .innerJoin(projects, eq(projects.id, projectRevisions.projectId))
      .where(
        and(
          eq(projectExports.id, exportId),
          eq(projects.ownerId, actor.id),
          isNull(projects.deletedAt),
          inArray(projectExports.status, ["ready", "failed"]),
        ),
      );
    if (!row) return false;
    await tx.delete(projectExports).where(eq(projectExports.id, exportId));
    if (row.assetId) {
      await tx
        .update(assets)
        .set({ state: "deleting", updatedAt: sql`now()` })
        .where(and(eq(assets.id, row.assetId), inArray(assets.state, ["pending", "ready"])));
    }
    return true;
  });
}
