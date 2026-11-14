"use server";

import {
  ADMIN_REFUSALS,
  applicationDecisionSchema,
  moderationDecisionSchema,
  PUBLISHING_REFUSALS,
  reportResolutionSchema,
  retryJobSchema,
  suspendUserSchema,
  takedownSchema,
  unsuspendUserSchema,
  type ActionResult,
} from "@foliomind/contracts";
import {
  decideSubmission,
  invalidateUserSnapshot,
  isAdmin,
  resolveReport,
  retryJobAsAdmin,
  reviewPublisherApplication,
  suspendUser,
  takedownBook,
  unsuspendUser,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { invalidateCatalog } from "@/lib/catalog/invalidate";
import { getCacheKeys, getDb, getRequestRedis } from "@/lib/clients";
import { deliverNow } from "@/lib/outbox";
import { rateLimitAction } from "@/lib/rate-limit";
import { getFreshUser } from "@/lib/session";

/*
 * Admin mutations (blueprint Sections 4, 5 rows 15–16, 23 and 28). Privileged
 * actions re-read the account from Postgres instead of trusting the cached
 * snapshot, carry the admin rate limit, and are audited by the domain.
 */

const FORBIDDEN = {
  ok: false,
  code: "forbidden",
  formError: "Only administrators can do this.",
} as const;

const invalid = (error: z.ZodError) =>
  ({
    ok: false,
    code: "invalid",
    fieldErrors: z.flattenError(error).fieldErrors,
    formError: error.issues[0]?.message,
  }) as const;

async function guard() {
  const admin = await getFreshUser();
  if (!admin || !isAdmin(admin)) return { admin: null, refused: FORBIDDEN };
  const limited = await rateLimitAction("adminMutation", await headers());
  if (limited) return { admin: null, refused: limited };
  return { admin, refused: null };
}

const MODERATION_MESSAGES = {
  not_found: "This submission isn't available anymore.",
  already_decided: PUBLISHING_REFUSALS.already_decided,
  source_processing: "The PDF is still being processed. Approve it once it's ready.",
} as const;

export async function decideSubmissionAction(input: unknown): Promise<ActionResult> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = moderationDecisionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await decideSubmission(getDb(), admin, parsed.data);
  if (!result.ok)
    return { ok: false, code: result.code, formError: MODERATION_MESSAGES[result.code] };
  await deliverNow(result.eventKeys);
  if (result.catalogChanged) {
    await invalidateCatalog({ bookIds: [result.bookId], publisherSlugs: [result.publisherSlug] });
  }
  return { ok: true, data: undefined };
}

export async function takedownBookAction(input: unknown): Promise<ActionResult> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = takedownSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await takedownBook(getDb(), admin, {
    bookId: parsed.data.bookId,
    reason: parsed.data.reason ?? "",
    reportId: parsed.data.reportId,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      formError:
        result.code === "already_decided"
          ? "This book was already taken down."
          : MODERATION_MESSAGES[result.code],
    };
  }
  await deliverNow(result.eventKeys);
  await invalidateCatalog({ bookIds: [result.bookId], publisherSlugs: [result.publisherSlug] });
  return { ok: true, data: undefined };
}

export async function resolveReportAction(input: unknown): Promise<ActionResult> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = reportResolutionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await resolveReport(getDb(), admin, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  return {
    ok: false,
    code: result.code,
    formError:
      result.code === "already_decided"
        ? PUBLISHING_REFUSALS.already_decided
        : "This report isn't available anymore.",
  };
}

export async function reviewApplicationAction(input: unknown): Promise<ActionResult> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = applicationDecisionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await reviewPublisherApplication(getDb(), admin, parsed.data);
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      formError:
        result.code === "already_decided"
          ? PUBLISHING_REFUSALS.already_decided
          : "This application isn't available anymore.",
    };
  }
  // The role changed: drop the cached snapshot so it applies on the next request.
  await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), result.userId);
  await deliverNow(result.eventKeys);
  return { ok: true, data: undefined };
}

export async function suspendUserAction(input: unknown): Promise<ActionResult> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = suspendUserSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await suspendUser(getDb(), admin, parsed.data);
  if (!result.ok) {
    const fieldErrors =
      result.code === "end_in_past" || result.code === "end_too_far"
        ? { endsOn: [ADMIN_REFUSALS[result.code]] }
        : undefined;
    return {
      ok: false,
      code: result.code,
      formError: ADMIN_REFUSALS[result.code],
      ...(fieldErrors ? { fieldErrors } : {}),
    };
  }
  // Section 23: suspension deletes the snapshot so it takes effect at once.
  await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), result.userId);
  return { ok: true, data: undefined };
}

export async function unsuspendUserAction(input: unknown): Promise<ActionResult> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = unsuspendUserSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await unsuspendUser(getDb(), admin, parsed.data);
  if (!result.ok) return { ok: false, code: result.code, formError: ADMIN_REFUSALS[result.code] };
  await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), result.userId);
  return { ok: true, data: undefined };
}

export async function retryJobAction(input: unknown): Promise<ActionResult<{ jobId: string }>> {
  const { admin, refused } = await guard();
  if (!admin) return refused;
  const parsed = retryJobSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await retryJobAsAdmin(getDb(), admin, parsed.data.jobId);
  if (!result.ok) return { ok: false, code: result.code, formError: ADMIN_REFUSALS[result.code] };
  await deliverNow(result.eventKeys);
  return { ok: true, data: { jobId: result.jobId } };
}
