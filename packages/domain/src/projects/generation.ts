import { randomUUID } from "node:crypto";
import {
  docHasText,
  EVENT_NAMES,
  PROJECT_JOB_KINDS,
  PROJECT_PROMPT_MIN,
  renumberCitations,
  readProjectDoc,
  sectionNodes,
  upsertDocSection,
  type DocSection,
  type GenerationCharge,
  type JobErrorCode,
  type OutlineSection,
  type ProjectAllowance,
  type ProjectBlock,
  type ProjectGenerateRequest,
  type ProjectRefusal,
  type ProjectStatus,
} from "@foliomind/contracts";
import {
  exports as projectExports,
  jobs,
  projects,
  usageBuckets,
  users,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Actor } from "../access";
import { currentEntitlement } from "../entitlements";
import { failJob, JobFailure, JobStopped, stopJob, succeedJob, updateJobProgress } from "../jobs";
import { enqueue } from "../outbox";
import { commit, release, reserve } from "../usage";
import { insertRevision } from "./content";
import {
  checkProjectSources,
  getOwnedProject,
  liveProjectJob,
  settledStatus,
  toProjectRecord,
  type ProjectRecord,
  type UsableSource,
} from "./records";

/*
 * Generation requests and their charges (blueprint Sections 9 and 10). One
 * credit covers a project's first outline and first draft; repeating either, or
 * rewriting a section, spends a regeneration. The reservation comes first, the
 * job and its outbox event are written together, and a failure or cancel
 * releases the reservation, so a retry never charges twice.
 */

/** Generations can wait in the queue; their reservation outlives the default hour. */
const GENERATION_RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;

const CREDIT_PREFIX = "project-credit";
export const creditKey = (jobId: string) => `${CREDIT_PREFIX}:${jobId}`;
export const regenerationKey = (jobId: string) => `project-regeneration:${jobId}`;
export const reexportKey = (jobId: string) => `project-reexport:${jobId}`;

const isCreditKey = (key: string | null) => key?.startsWith(`${CREDIT_PREFIX}:`) ?? false;

/** What the next outline would cost (shown beside the button). */
export const outlineCharge = (
  project: Pick<ProjectRecord, "creditOperationKey" | "firstDraftAt" | "outline">,
): GenerationCharge =>
  !project.creditOperationKey && !project.firstDraftAt && project.outline.length === 0
    ? "project"
    : "regeneration";

/** What the next draft would cost: the credit covers the first one. */
export const draftCharge = (
  project: Pick<ProjectRecord, "creditOperationKey" | "firstDraftAt">,
): GenerationCharge => {
  if (project.firstDraftAt) return "regeneration";
  return project.creditOperationKey ? "none" : "project";
};

export type GenerationOutcome =
  { ok: true; jobId: string; eventKey: string } | { ok: false; code: ProjectRefusal };

class Refused extends Error {
  constructor(readonly code: ProjectRefusal) {
    super(code);
  }
}

const JOB_KIND = {
  outline: "generate-outline",
  draft: "generate-draft",
  section: "regenerate-section",
} as const;

export async function requestProjectGeneration(
  db: Database,
  actor: Actor,
  projectId: string,
  request: ProjectGenerateRequest,
  now: Date = new Date(),
): Promise<GenerationOutcome> {
  if (actor.status !== "active") return { ok: false, code: "account_inactive" };
  const project = await getOwnedProject(db, actor, projectId);
  if (!project) return { ok: false, code: "not_found" };
  if (project.archivedAt) return { ok: false, code: "archived" };
  if (await liveProjectJob(db, projectId)) return { ok: false, code: "busy" };
  if (project.prompt.trim().length < PROJECT_PROMPT_MIN) return { ok: false, code: "no_prompt" };

  if (request.kind !== "outline" && project.outline.length < 3) {
    return { ok: false, code: "no_outline" };
  }
  if (request.kind === "draft" && project.firstDraftAt && !request.replace) {
    return { ok: false, code: "replace_required" };
  }
  if (request.kind === "section" && !sectionNodes(project.content, request.sectionId)) {
    return { ok: false, code: "section_missing" };
  }
  const sources = await checkProjectSources(db, actor, project);
  if (!sources.ok) return { ok: false, code: sources.code };

  const charge: GenerationCharge =
    request.kind === "outline"
      ? outlineCharge(project)
      : request.kind === "draft"
        ? draftCharge(project)
        : "regeneration";
  const jobId = randomUUID();
  const usageKey =
    charge === "project"
      ? creditKey(jobId)
      : charge === "regeneration"
        ? regenerationKey(jobId)
        : null;
  if (usageKey) {
    const reserved = await reserve(db, {
      userId: actor.id,
      metric: charge === "project" ? "generated_projects" : "section_regenerations",
      quantity: 1,
      operationKey: usageKey,
      expiresAt: new Date(now.getTime() + GENERATION_RESERVATION_TTL_MS),
      now,
    });
    if (!reserved.ok) {
      return { ok: false, code: charge === "project" ? "quota_projects" : "quota_regenerations" };
    }
  }

  const kind = JOB_KIND[request.kind];
  const operationKey = `${kind}:${jobId}`;
  try {
    await db.transaction(async (tx) => {
      const locked = await getOwnedProject(tx, actor, projectId, { lock: true });
      if (!locked) throw new Refused("not_found");
      if (await liveProjectJob(tx, projectId)) throw new Refused("busy");

      // Redrafting replaces the owner's text, so it's kept as a revision first (Section 20 #11).
      const replacing = request.kind === "draft" && request.replace;
      if (replacing && docHasText(locked.content)) {
        await insertRevision(tx, {
          project: locked,
          content: renumberCitations(locked.content),
          createdBy: actor.id,
        });
      }
      await tx.insert(jobs).values({
        id: jobId,
        ownerId: actor.id,
        kind,
        targetId: projectId,
        operationKey,
      });
      const status: ProjectStatus | null =
        request.kind === "outline" ? "outline" : request.kind === "draft" ? "drafting" : null;
      if (status) {
        await tx
          .update(projects)
          .set({ status, updatedAt: sql`now()` })
          .where(eq(projects.id, projectId));
      }
      const base = { projectId, ownerId: actor.id, jobId, operationKey, usageKey };
      if (request.kind === "outline") {
        await enqueue(tx, {
          key: operationKey,
          name: EVENT_NAMES.projectOutlineRequested,
          data: base,
        });
      } else if (request.kind === "draft") {
        await enqueue(tx, {
          key: operationKey,
          name: EVENT_NAMES.projectDraftRequested,
          data: { ...base, replace: replacing },
        });
      } else {
        await enqueue(tx, {
          key: operationKey,
          name: EVENT_NAMES.projectSectionRequested,
          data: { ...base, sectionId: request.sectionId },
        });
      }
    });
  } catch (error) {
    if (usageKey) await release(db, usageKey);
    if (error instanceof Refused) return { ok: false, code: error.code };
    throw error;
  }
  return { ok: true, jobId, eventKey: operationKey };
}

/* --- Background functions ----------------------------------------------- */

/** Stops a delayed step when its job was cancelled or its project deleted (Section 9). */
export async function assertProjectJobCanContinue(
  db: Executor,
  jobId: string,
  projectId: string,
): Promise<void> {
  const [row] = await db
    .select({
      status: jobs.status,
      cancelRequested: jobs.cancelRequested,
      deletedAt: projects.deletedAt,
      projectExists: projects.id,
    })
    .from(jobs)
    .leftJoin(projects, eq(projects.id, projectId))
    .where(eq(jobs.id, jobId));
  if (!row || !row.projectExists) throw new JobStopped("missing");
  if (row.deletedAt) throw new JobStopped("deleted");
  if (row.cancelRequested || !["queued", "running"].includes(row.status)) {
    throw new JobStopped("cancelled");
  }
}

export interface GenerationContext {
  project: ProjectRecord;
  actor: Actor;
  sources: UsableSource[];
}

/**
 * The project and its sources, with the owner's status and access checked now,
 * not when the request was made. A source that became unavailable stops the run.
 */
export async function loadGenerationContext(
  db: Executor,
  input: { projectId: string; ownerId: string },
): Promise<GenerationContext> {
  const [owner] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, input.ownerId));
  if (!owner || owner.status !== "active") throw new JobStopped("missing");
  const actor: Actor = { id: input.ownerId, status: "active" };
  const project = await getOwnedProject(db, actor, input.projectId);
  if (!project) throw new JobStopped("missing");
  const sources = await checkProjectSources(db, actor, project);
  if (!sources.ok) throw new JobFailure("source_unavailable");
  return { project, actor, sources: sources.sources };
}

/** A finished step retried by Inngest finds its job already finished and does nothing. */
export async function jobAlreadySucceeded(db: Executor, jobId: string): Promise<boolean> {
  const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
  return row?.status === "succeeded";
}

/** Reservation moves into consumption. Runs in its own step, so it survives a retry. */
export async function commitProjectUsage(db: Database, usageKey: string | null): Promise<void> {
  if (usageKey) await commit(db, usageKey);
}

/** Saves the outline; the owner reviews it next, and nothing is drafted until they approve. */
export async function saveGeneratedOutline(
  db: Database,
  input: {
    projectId: string;
    jobId: string;
    usageKey: string | null;
    outline: OutlineSection[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({
        outline: input.outline,
        status: sql`case when ${projects.firstDraftAt} is null then 'outline' else 'editing' end`,
        ...(isCreditKey(input.usageKey) ? { creditOperationKey: input.usageKey } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, input.projectId));
    await succeedJob(tx, input.jobId, { sections: input.outline.length });
  });
}

/** Clears what a redraft replaces. Sections come back one at a time. */
export async function startDraft(
  db: Database,
  input: { projectId: string; replace: boolean },
): Promise<void> {
  if (!input.replace) return;
  await db
    .update(projects)
    .set({
      editorContent: { type: "doc", content: [] },
      // Waiting proposals were written for the text that's going away.
      sectionProposals: [],
      revisionCounter: sql`${projects.revisionCounter} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(projects.id, input.projectId));
}

/**
 * One finished section goes into the document, so the editor fills as it's
 * written. Writing the same section twice replaces it, so a retried step is safe.
 */
export async function saveDraftSection(
  db: Database,
  input: {
    projectId: string;
    jobId: string;
    section: DocSection;
    outlineIds: readonly string[];
    done: number;
    total: number;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ content: projects.editorContent })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for("update");
    if (!row) throw new JobStopped("missing");
    const content = renumberCitations(
      upsertDocSection(readProjectDoc(row.content), input.section, input.outlineIds),
    );
    await tx
      .update(projects)
      .set({
        editorContent: content,
        revisionCounter: sql`${projects.revisionCounter} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, input.projectId));
    await updateJobProgress(tx, input.jobId, { sections: input.total, sectionsDone: input.done });
  });
}

/** Every section is in: the first revision is created and the owner can edit (Phase 8 skill). */
export async function finishDraft(
  db: Database,
  input: { projectId: string; jobId: string; ownerId: string; usageKey: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for("update");
    if (!row) throw new JobStopped("missing");
    const project = toProjectRecord(row);
    const content = renumberCitations(project.content);
    await insertRevision(tx, { project, content, createdBy: input.ownerId });
    await tx
      .update(projects)
      .set({
        editorContent: content,
        revisionCounter: sql`${projects.revisionCounter} + 1`,
        status: "editing",
        firstDraftAt: sql`coalesce(${projects.firstDraftAt}, now())`,
        ...(isCreditKey(input.usageKey) ? { creditOperationKey: input.usageKey } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, input.projectId));
    await succeedJob(tx, input.jobId);
  });
}

/** A regenerated section waits beside the current text; it never replaces anything here. */
export async function saveSectionProposal(
  db: Database,
  input: { projectId: string; jobId: string; sectionId: string; nodes: ProjectBlock[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for("update");
    if (!row) throw new JobStopped("missing");
    const project = toProjectRecord(row);
    await tx
      .update(projects)
      .set({
        sectionProposals: [
          ...project.proposals.filter((item) => item.sectionId !== input.sectionId),
          {
            sectionId: input.sectionId,
            jobId: input.jobId,
            nodes: input.nodes,
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, input.projectId));
    await succeedJob(tx, input.jobId);
  });
}

/** Failure (Section 9): the job records why, the reservation goes back and the status settles. */
export async function failProjectJob(
  db: Database,
  input: {
    jobId: string;
    projectId: string;
    usageKey: string | null;
    code: JobErrorCode;
    /** Outline and draft failures show on the project; a section's only in the Studio. */
    markProject: boolean;
  },
): Promise<boolean> {
  const failed = await failJob(db, input.jobId, input.code);
  if (input.usageKey) await release(db, input.usageKey);
  if (failed && input.markProject) {
    await db
      .update(projects)
      .set({ status: "failed", updatedAt: sql`now()` })
      .where(eq(projects.id, input.projectId));
  }
  return failed;
}

/** A run stopped by its owner or by deletion ends cancelled, with its charge returned. */
export async function stopProjectJob(
  db: Database,
  input: { jobId: string; projectId: string; usageKey: string | null },
): Promise<void> {
  await stopJob(db, input.jobId);
  if (input.usageKey) await release(db, input.usageKey);
  await settleProject(db, input.projectId);
}

async function settleProject(db: Executor, projectId: string): Promise<void> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!row || row.deletedAt) return;
  await db
    .update(projects)
    .set({ status: settledStatus(toProjectRecord(row)), updatedAt: sql`now()` })
    .where(eq(projects.id, projectId));
}

/**
 * `POST /api/jobs/:id/cancel` for generation (Section 9): the job is cancelled
 * at once, the charge returned, and the event stops the run between steps.
 * Sections already written stay in the document. An export can only be stopped
 * before it starts: once rendering, it finishes in seconds. This is also what
 * frees a project whose event was lost, so it can never stay locked.
 */
export async function requestProjectJobCancel(
  db: Database,
  ownerId: string,
  jobId: string,
): Promise<{ eventKey: string } | null> {
  const eventKey = `cancel:${jobId}`;
  const cancelled = await db.transaction(async (tx) => {
    const [job] = await tx
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
          inArray(jobs.kind, [...PROJECT_JOB_KINDS]),
          sql`(${jobs.kind} <> 'render-export' or ${jobs.status} = 'queued')`,
        ),
      )
      .returning({ targetId: jobs.targetId, operationKey: jobs.operationKey });
    if (!job) return null;
    await tx
      .update(projectExports)
      .set({ status: "failed", updatedAt: sql`now()` })
      .where(eq(projectExports.jobId, jobId));
    await enqueue(tx, {
      key: eventKey,
      name: EVENT_NAMES.projectGenerationCancelled,
      data: { jobId, ownerId, operationKey: job.operationKey },
    });
    if (job.targetId) await settleProject(tx, job.targetId);
    return job;
  });
  if (!cancelled) return null;
  await releaseProjectJobUsage(db, jobId);
  return { eventKey };
}

/** A deleted project's run is told to stop too, so it doesn't use up its remaining steps. */
export async function stopProjectForDeletion(
  db: Database,
  ownerId: string,
  jobId: string,
): Promise<{ eventKey: string }> {
  const eventKey = `cancel:${jobId}`;
  await enqueue(db, {
    key: eventKey,
    name: EVENT_NAMES.projectGenerationCancelled,
    data: { jobId, ownerId, operationKey: `delete:${jobId}` },
  });
  return { eventKey };
}

/** Returns whichever charge this job held. Unknown keys are ignored. */
export async function releaseProjectJobUsage(db: Database, jobId: string): Promise<void> {
  for (const key of [creditKey(jobId), regenerationKey(jobId), reexportKey(jobId)]) {
    await release(db, key);
  }
}

/** The allowances the Studio shows before anything is spent (Section 6 step 9). */
export async function projectAllowance(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<ProjectAllowance> {
  const { planCode, limits, period } = await currentEntitlement(db, userId, now);
  const rows = await db
    .select({
      metric: usageBuckets.metric,
      limit: usageBuckets.limit,
      used: sql<number>`(${usageBuckets.reserved} + ${usageBuckets.consumed})::bigint`.mapWith(
        Number,
      ),
    })
    .from(usageBuckets)
    .where(and(eq(usageBuckets.userId, userId), eq(usageBuckets.periodStart, period.start)));
  const read = (metric: string, fallback: number) => {
    const row = rows.find((item) => item.metric === metric);
    return { used: row?.used ?? 0, limit: row?.limit ?? fallback };
  };
  return {
    planCode,
    projects: read("generated_projects", limits.generatedProjectsPerMonth),
    regenerations: read("section_regenerations", limits.sectionRegenerationsPerMonth),
    reexports: read("reexports", limits.reexportsPerMonth),
    resetsAt: period.end.toISOString(),
  };
}
