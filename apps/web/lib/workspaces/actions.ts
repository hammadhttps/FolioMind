"use server";

import {
  createProjectFromWorkspaceSchema,
  saveAnswerNoteSchema,
  SOURCE_PICKER_PAGE_SIZE,
  sourcePickerQuerySchema,
  updateNoteSchema,
  WORKSPACE_PAGE_SIZE,
  workspaceFormSchema,
  workspaceSourceInputSchema,
  workspaceUpdateSchema,
  type ActionResult,
} from "@foliomind/contracts";
import { workspaceSearchParamsSchema } from "@foliomind/contracts/search-params";
import {
  addWorkspaceSource,
  createProjectFromWorkspace,
  createWorkspace,
  createWorkspaceNote,
  deleteWorkspace,
  deleteWorkspaceNote,
  listSourceCandidates,
  listWorkspaces,
  removeWorkspaceSource,
  saveAnswerToNotes,
  updateWorkspace,
  updateWorkspaceNote,
  type SourceCandidate,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { toNoteView, toWorkspaceCard, type NoteView, type WorkspaceCardView } from "./view";

/*
 * Research Workspace mutations (blueprint Sections 11 and 28). Every action
 * re-parses its input and checks ownership in the domain service. Next.js
 * checks each Server Action's Origin.
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
  formError: "This workspace isn't available anymore.",
} as const;
const invalid = (error: z.ZodError) =>
  ({
    ok: false,
    code: "invalid",
    fieldErrors: z.flattenError(error).fieldErrors,
    formError: error.issues[0]?.message,
  }) as const;

export async function createWorkspaceAction(
  input: unknown,
): Promise<ActionResult<WorkspaceCardView>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = workspaceFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const workspace = await createWorkspace(getDb(), user, parsed.data);
  return workspace ? { ok: true, data: toWorkspaceCard(workspace) } : NOT_FOUND;
}

export async function updateWorkspaceAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = workspaceUpdateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { workspaceId, ...values } = parsed.data;
  return (await updateWorkspace(getDb(), user, workspaceId, values))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

/** Sources, notes and conversations go; the original documents stay (Section 11). */
export async function deleteWorkspaceAction(workspaceId: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(workspaceId);
  if (!id.success) return NOT_FOUND;
  return (await deleteWorkspace(getDb(), user, id.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

export async function loadMoreWorkspacesAction(
  params: unknown,
  cursor: unknown,
): Promise<ActionResult<{ items: WorkspaceCardView[]; nextCursor: string | null }>> {
  const { user, limited } = await guard("authenticatedRead");
  if (limited) return limited;
  const filters = workspaceSearchParamsSchema.parse(params ?? {});
  const page = await listWorkspaces(getDb(), {
    userId: user.id,
    q: filters.q,
    sort: filters.sort,
    cursor: typeof cursor === "string" ? cursor : undefined,
    limit: WORKSPACE_PAGE_SIZE,
  });
  return {
    ok: true,
    data: { items: page.items.map(toWorkspaceCard), nextCursor: page.nextCursor },
  };
}

export async function listSourceCandidatesAction(
  input: unknown,
): Promise<ActionResult<{ items: SourceCandidate[]; nextCursor: string | null }>> {
  const { user, limited } = await guard("authenticatedRead");
  if (limited) return limited;
  const parsed = sourcePickerQuerySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const page = await listSourceCandidates(getDb(), user, {
    ...parsed.data,
    q: parsed.data.q && parsed.data.q.length >= 2 ? parsed.data.q : undefined,
    limit: SOURCE_PICKER_PAGE_SIZE,
  });
  return page ? { ok: true, data: page } : NOT_FOUND;
}

export async function addWorkspaceSourceAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = workspaceSourceInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await addWorkspaceSource(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  switch (result.code) {
    case "source_limit":
      return {
        ok: false,
        code: "source_limit",
        formError: `Your plan allows ${result.limit} sources in a workspace.`,
      };
    case "not_ready":
      return {
        ok: false,
        code: "not_ready",
        formError: "That document isn't ready yet. Add it once it finishes processing.",
      };
    case "already_added":
      return { ok: false, code: "already_added", formError: "That source is already here." };
    default:
      return {
        ok: false,
        code: "not_found",
        formError: "That document isn't available anymore.",
      };
  }
}

export async function removeWorkspaceSourceAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = workspaceSourceInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return (await removeWorkspaceSource(getDb(), user, parsed.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

export async function createNoteAction(workspaceId: unknown): Promise<ActionResult<NoteView>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(workspaceId);
  if (!id.success) return NOT_FOUND;
  const note = await createWorkspaceNote(getDb(), user, id.data);
  return note ? { ok: true, data: toNoteView(note) } : NOT_FOUND;
}

export async function updateNoteAction(input: unknown): Promise<ActionResult<{ savedAt: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const note = await updateWorkspaceNote(getDb(), user, parsed.data.noteId, parsed.data.body);
  return note ? { ok: true, data: { savedAt: note.updatedAt.toISOString() } } : NOT_FOUND;
}

export async function deleteNoteAction(noteId: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(noteId);
  if (!id.success) return NOT_FOUND;
  return (await deleteWorkspaceNote(getDb(), user, id.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

export async function saveAnswerToNotesAction(input: unknown): Promise<ActionResult<NoteView>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = saveAnswerNoteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const note = await saveAnswerToNotes(getDb(), user, parsed.data);
  return note ? { ok: true, data: toNoteView(note) } : NOT_FOUND;
}

/** Turn into a PDF: the project record only; PDF Studio does the rest (Phase 8). */
export async function createProjectFromWorkspaceAction(
  input: unknown,
): Promise<ActionResult<{ projectId: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = createProjectFromWorkspaceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await createProjectFromWorkspace(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: { projectId: result.projectId } };
  return result.code === "no_sources"
    ? {
        ok: false,
        code: "no_sources",
        formError: "None of the selected sources are available.",
      }
    : NOT_FOUND;
}
