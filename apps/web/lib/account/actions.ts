"use server";

import {
  profileFormSchema,
  themePreferenceSchema,
  type ActionResult,
  type ProfileFormValues,
} from "@foliomind/contracts";
import {
  invalidateUserSnapshot,
  updateDisplayName,
  updateThemePreference,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getCacheKeys, getDb, getRequestRedis } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

/*
 * Settings mutations (blueprint Sections 11 and 28). Each parses its input
 * again on the server; the client's validation is only for feedback. Next.js
 * checks the Origin of every Server Action.
 */

export async function updateProfile(
  input: ProfileFormValues,
): Promise<ActionResult<ProfileFormValues>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;

  const parsed = profileFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  await updateDisplayName(getDb(), user.id, parsed.data.displayName);
  await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), user.id);
  return { ok: true, data: parsed.data };
}

export async function updateTheme(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;

  const theme = themePreferenceSchema.safeParse(input);
  if (!theme.success)
    return { ok: false, code: "invalid", formError: "Choose light, dark or system." };
  await updateThemePreference(getDb(), user.id, theme.data);
  await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), user.id);
  return { ok: true, data: undefined };
}
