"use server";

import { threadRenameSchema, type ActionResult, type MessageView } from "@foliomind/contracts";
import { deleteThread, listMessages, renameThread } from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

/*
 * Conversation threads (blueprint Section 11): a reader's own messages and
 * titles. Every action checks ownership in the domain service; another user's
 * thread reads as not found.
 */

const NOT_FOUND = {
  ok: false,
  code: "not_found",
  formError: "This conversation isn't available anymore.",
} as const;

const loadThreadSchema = z.object({
  conversationId: z.uuid(),
  cursor: z.string().max(500).optional(),
});

export async function loadThreadAction(
  input: unknown,
): Promise<ActionResult<{ messages: MessageView[]; nextCursor: string | null }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedRead", await headers());
  if (limited) return limited;
  const parsed = loadThreadSchema.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const page = await listMessages(getDb(), user, parsed.data.conversationId, {
    cursor: parsed.data.cursor,
  });
  return page ? { ok: true, data: page } : NOT_FOUND;
}

export async function renameThreadAction(input: unknown): Promise<ActionResult<{ title: string }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = threadRenameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const renamed = await renameThread(
    getDb(),
    user.id,
    parsed.data.conversationId,
    parsed.data.title,
  );
  return renamed ? { ok: true, data: { title: parsed.data.title } } : NOT_FOUND;
}

/** Deleting a thread removes its messages and citations; old messages are never rewritten. */
export async function deleteThreadAction(conversationId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const id = z.uuid().safeParse(conversationId);
  if (!id.success) return NOT_FOUND;
  return (await deleteThread(getDb(), user.id, id.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}
