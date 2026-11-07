"use server";

import {
  createProjectSchema,
  projectDocSchema,
  projectSourceInputSchema,
  projectSourceQuerySchema,
  renameProjectSchema,
  saveOutlineSchema,
  saveProjectContentSchema,
  saveStudioSettingsSchema,
  SOURCE_PICKER_PAGE_SIZE,
  type ActionResult,
  type ProjectDoc,
  type ProjectRevisionView,
} from "@foliomind/contracts";
import {
  acceptSectionProposal,
  addProjectSource,
  createProject,
  declineSectionProposal,
  deleteProjectExport,
  duplicateProject,
  exportChargeFor,
  keepTextAsRevision,
  listSourceCandidates,
  overwriteAfterConflict,
  releaseProjectJobUsage,
  removeProjectSource,
  renameProject,
  restoreProjectRevision,
  saveProjectContent,
  saveProjectOutline,
  saveProjectRevision,
  saveStudioSettings,
  setProjectArchived,
  softDeleteProject,
  stopProjectForDeletion,
  type ContentChangeOutcome,
  type ExportCharge,
  type SourceCandidate,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { deliverNow } from "@/lib/outbox";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

/*
 * Project and Studio mutations (blueprint Sections 11 and 28). Every action
 * re-parses its input and checks ownership in the domain service; Next.js checks
 * each Server Action's Origin. Starting generation or an export goes through the
 * route handlers, which carry the `generation` rate limit.
 */

async function guard(
  kind: "authenticatedMutation" | "authenticatedRead" = "authenticatedMutation",
) {
  const user = await requireUser();
  const limited = await rateLimitAction(kind, await headers());
  return { user, limited };
}

const NOT_FOUND = {
  ok: false,
  code: "not_found",
  formError: "This project isn't available anymore.",
} as const;
const ARCHIVED = {
  ok: false,
  code: "archived",
  formError: "This project is archived. Restore it to keep working.",
} as const;
const BUSY = {
  ok: false,
  code: "busy",
  formError: "This project is working on something. Wait for it to finish, or stop it first.",
} as const;
const invalid = (error: z.ZodError) =>
  ({
    ok: false,
    code: "invalid",
    fieldErrors: z.flattenError(error).fieldErrors,
    formError: error.issues[0]?.message,
  }) as const;

export async function createProjectAction(
  input: unknown,
): Promise<ActionResult<{ projectId: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await createProject(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: { projectId: result.projectId } };
  return result.code === "source_unavailable"
    ? {
        ok: false,
        code: "source_unavailable",
        formError: "A source you picked isn't available anymore. Pick another.",
      }
    : NOT_FOUND;
}

export async function renameProjectAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = renameProjectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return (await renameProject(getDb(), user, parsed.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

export async function duplicateProjectAction(
  projectId: unknown,
): Promise<ActionResult<{ projectId: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(projectId);
  if (!id.success) return NOT_FOUND;
  const copy = await duplicateProject(getDb(), user, id.data);
  return copy ? { ok: true, data: { projectId: copy } } : NOT_FOUND;
}

export async function setProjectArchivedAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = z.object({ projectId: z.uuid(), archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const result = await setProjectArchived(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  return result.code === "busy" ? BUSY : NOT_FOUND;
}

/** Access stops now; files and the row follow with the daily cleanup (Section 11). */
export async function deleteProjectAction(projectId: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(projectId);
  if (!id.success) return NOT_FOUND;
  const db = getDb();
  const result = await softDeleteProject(db, user, id.data);
  if (!result.deleted) return NOT_FOUND;
  if (result.stoppedJobId) {
    await releaseProjectJobUsage(db, result.stoppedJobId);
    const stopped = await stopProjectForDeletion(db, user.id, result.stoppedJobId);
    await deliverNow([stopped.eventKey]);
  }
  return { ok: true, data: undefined };
}

/** Ready documents only, recently opened first (Section 24), for a project's source picker. */
export async function listProjectSourceCandidatesAction(
  input: unknown,
): Promise<ActionResult<{ items: SourceCandidate[]; nextCursor: string | null }>> {
  const { user, limited } = await guard("authenticatedRead");
  if (limited) return limited;
  const parsed = projectSourceQuerySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const page = await listSourceCandidates(getDb(), user, {
    ...parsed.data,
    q: parsed.data.q && parsed.data.q.length >= 2 ? parsed.data.q : undefined,
    limit: SOURCE_PICKER_PAGE_SIZE,
  });
  return page ? { ok: true, data: page } : NOT_FOUND;
}

export async function saveStudioSettingsAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = saveStudioSettingsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await saveStudioSettings(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  switch (result.code) {
    case "archived":
      return ARCHIVED;
    case "busy":
      return BUSY;
    case "mode_locked":
      return {
        ok: false,
        code: "mode_locked",
        formError:
          "This document already has a draft, so its mode can't change. Duplicate it to start over.",
      };
    default:
      return NOT_FOUND;
  }
}

export async function saveOutlineAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = saveOutlineSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await saveProjectOutline(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  return result.code === "archived" ? ARCHIVED : result.code === "busy" ? BUSY : NOT_FOUND;
}

export async function addProjectSourceAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = projectSourceInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await addProjectSource(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  switch (result.code) {
    case "source_limit":
      return { ok: false, code: "source_limit", formError: "A project can have up to 5 sources." };
    case "not_ready":
      return {
        ok: false,
        code: "not_ready",
        formError: "That document isn't ready yet. Add it once it finishes processing.",
      };
    case "already_added":
      return { ok: false, code: "already_added", formError: "That source is already here." };
    case "archived":
      return ARCHIVED;
    case "busy":
      return BUSY;
    default:
      return { ok: false, code: "not_found", formError: "That document isn't available anymore." };
  }
}

export async function removeProjectSourceAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = projectSourceInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await removeProjectSource(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  return result.code === "busy" ? BUSY : NOT_FOUND;
}

/** Autosave. A conflict returns the counter, so the dialog can offer a way forward. */
export async function saveContentAction(
  input: unknown,
): Promise<ActionResult<{ counter: number }> | { ok: false; code: "conflict"; counter: number }> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = saveProjectContentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await saveProjectContent(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: { counter: result.counter } };
  switch (result.code) {
    case "conflict":
      return { ok: false, code: "conflict", counter: result.counter };
    case "archived":
      return ARCHIVED;
    case "busy":
      return BUSY;
    default:
      return NOT_FOUND;
  }
}

export interface SavedRevision {
  revision: ProjectRevisionView;
  created: boolean;
  content: ProjectDoc;
  counter: number;
  exportCharge: ExportCharge;
}

/** "Save revision": freezes the project's saved text, and says what exporting it would cost. */
export async function saveRevisionAction(projectId: unknown): Promise<ActionResult<SavedRevision>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(projectId);
  if (!id.success) return NOT_FOUND;
  const db = getDb();
  const result = await saveProjectRevision(db, user, id.data);
  if (result.ok) {
    return {
      ok: true,
      data: {
        revision: result.revision,
        created: result.created,
        content: result.content,
        counter: result.counter,
        exportCharge: await exportChargeFor(db, id.data, result.revision.id),
      },
    };
  }
  switch (result.code) {
    case "archived":
      return ARCHIVED;
    case "busy":
      return BUSY;
    case "empty_document":
      return {
        ok: false,
        code: "empty_document",
        formError: "Write something first. There's nothing to save yet.",
      };
    default:
      return NOT_FOUND;
  }
}

export interface ContentChange {
  content: ProjectDoc;
  counter: number;
}

function toContentResult(
  result: ContentChangeOutcome,
): ActionResult<ContentChange> | { ok: false; code: "conflict"; counter: number } {
  if (result.ok) return { ok: true, data: { content: result.content, counter: result.counter } };
  switch (result.code) {
    case "conflict":
      return { ok: false, code: "conflict", counter: result.counter };
    case "archived":
      return ARCHIVED;
    case "busy":
      return BUSY;
    case "section_missing":
      return {
        ok: false,
        code: "section_missing",
        formError: "That section isn't in the document anymore.",
      };
    default:
      return NOT_FOUND;
  }
}

const proposalInput = z.object({
  projectId: z.uuid(),
  sectionId: z.uuid(),
  baseCounter: z.number().int().nonnegative(),
});

export async function acceptProposalAction(input: unknown) {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = proposalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return toContentResult(await acceptSectionProposal(getDb(), user, parsed.data));
}

export async function declineProposalAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = proposalInput.pick({ projectId: true, sectionId: true }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return (await declineSectionProposal(getDb(), user, parsed.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

const restoreInput = z.object({
  projectId: z.uuid(),
  revisionId: z.uuid(),
  baseCounter: z.number().int().nonnegative(),
});

export async function restoreRevisionAction(input: unknown) {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = restoreInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return toContentResult(await restoreProjectRevision(getDb(), user, parsed.data));
}

const conflictInput = z.object({
  projectId: z.uuid(),
  choice: z.enum(["keep-mine", "use-theirs"]),
  content: projectDocSchema,
});

/** "This project changed in another tab": either choice keeps the other text as a revision. */
export async function resolveConflictAction(input: unknown) {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = conflictInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { projectId, choice, content } = parsed.data;
  return toContentResult(
    choice === "keep-mine"
      ? await overwriteAfterConflict(getDb(), user, { projectId, content })
      : await keepTextAsRevision(getDb(), user, { projectId, content }),
  );
}

export async function deleteExportAction(exportId: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(exportId);
  if (!id.success) return NOT_FOUND;
  return (await deleteProjectExport(getDb(), user, id.data))
    ? { ok: true, data: undefined }
    : { ok: false, code: "not_found", formError: "That export isn't available anymore." };
}
