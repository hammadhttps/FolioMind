"use server";

import { PUBLISHING_REFUSALS, reportFormSchema, type ActionResult } from "@foliomind/contracts";
import { reportBook, setBookSaved, setFollow } from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getCacheKeys, getDb, getRequestRedis } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

/*
 * Reader actions on the public catalog (blueprint Sections 11, 20 and 28):
 * save to library, follow a publisher and report a concern. Each re-parses its
 * input; the domain checks the book or publisher is still public.
 */

const NOT_FOUND = {
  ok: false,
  code: "not_found",
  formError: "This isn't available anymore.",
} as const;

const invalid = (error: z.ZodError) =>
  ({
    ok: false,
    code: "invalid",
    fieldErrors: z.flattenError(error).fieldErrors,
    formError: error.issues[0]?.message,
  }) as const;

const saveSchema = z.object({ bookId: z.uuid(), saved: z.boolean() });

export async function setBookSavedAction(
  input: unknown,
): Promise<ActionResult<{ saved: boolean }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await setBookSaved(
    getDb(),
    { redis: getRequestRedis(), keys: getCacheKeys() },
    user,
    parsed.data,
  );
  return result.ok ? { ok: true, data: { saved: result.saved } } : NOT_FOUND;
}

const followSchema = z.object({
  publisherId: z.uuid(),
  following: z.boolean(),
  notify: z.boolean().optional(),
});

export async function setFollowAction(
  input: unknown,
): Promise<ActionResult<{ following: boolean; notify: boolean }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = followSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await setFollow(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: { following: result.following, notify: result.notify } };
  return result.code === "cannot_follow"
    ? { ok: false, code: "cannot_follow", formError: "You can't follow your own publisher page." }
    : NOT_FOUND;
}

/** Section 23: content reports are limited to 5 an hour and refused when Redis can't answer. */
export async function reportBookAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limited = await rateLimitAction("reportOrApplication", await headers());
  if (limited) return limited;
  const parsed = reportFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await reportBook(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  return { ok: false, code: result.code, formError: PUBLISHING_REFUSALS[result.code] };
}
