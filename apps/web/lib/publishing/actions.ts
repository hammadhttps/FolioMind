"use server";

import {
  bookDraftSchema,
  publisherApplicationSchema,
  publisherProfileSchema,
  PUBLISHING_REFUSALS,
  type ActionResult,
  type BookSubmissionInput,
  type PublishingRefusalCode,
} from "@foliomind/contracts";
import {
  applyToPublish,
  createBook,
  deleteBookDraft,
  markAssetsDeleted,
  removeDraftCover,
  reviseBook,
  saveBookDraft,
  submitBook,
  unpublishBook,
  updatePublisherProfile,
  withdrawSubmission,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { invalidateCatalog } from "@/lib/catalog/invalidate";
import { getDb, getUtApi } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser, requireVerifiedEmail, AccessDeniedError } from "@/lib/session";

/*
 * Publisher Dashboard mutations (blueprint Sections 5 row 12, 11 and 28). The
 * domain re-reads the role, the approved profile and the book's owner on every
 * call, so hiding a control is never what protects it.
 */

const refusal = (
  code: PublishingRefusalCode,
  fieldErrors?: Record<string, string[] | undefined>,
): Extract<ActionResult, { ok: false }> => ({
  ok: false,
  code,
  formError: PUBLISHING_REFUSALS[code],
  ...(fieldErrors ? { fieldErrors } : {}),
});

const invalid = (error: z.ZodError) =>
  ({
    ok: false,
    code: "invalid",
    fieldErrors: z.flattenError(error).fieldErrors,
    formError: error.issues[0]?.message,
  }) as const;

async function guard(
  kind: "authenticatedMutation" | "reportOrApplication" = "authenticatedMutation",
) {
  const user = await requireUser();
  const limited = await rateLimitAction(kind, await headers());
  return { user, limited };
}

/** Removes revoked files from storage after the response; the cleanup retries failures. */
function deleteFilesLater(fileKeys: readonly string[]) {
  if (fileKeys.length === 0) return;
  after(async () => {
    const deleted = await getUtApi()
      .deleteFiles([...fileKeys])
      .then((result) => result.success)
      .catch(() => false);
    if (deleted) await markAssetsDeleted(getDb(), fileKeys);
  });
}

/** Section 28 "Publisher application"; 5 an hour, refused when Redis can't answer (Section 23). */
export async function applyToPublishAction(input: unknown): Promise<ActionResult> {
  let user;
  try {
    // Section 22 rule 2: a verified email is needed to apply.
    user = await requireVerifiedEmail();
  } catch (error) {
    if (error instanceof AccessDeniedError) return refusal("email_unverified");
    throw error;
  }
  const limited = await rateLimitAction("reportOrApplication", await headers());
  if (limited) return limited;
  const parsed = publisherApplicationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await applyToPublish(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: undefined };
  return result.code === "slug_taken"
    ? refusal("slug_taken", { slug: [PUBLISHING_REFUSALS.slug_taken] })
    : refusal(result.code);
}

export async function updatePublisherProfileAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = publisherProfileSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await updatePublisherProfile(getDb(), user, parsed.data);
  if (!result.ok) {
    return result.code === "not_publisher"
      ? refusal("not_publisher")
      : refusal(result.code, { slug: [PUBLISHING_REFUSALS[result.code]] });
  }
  // The name and address appear on public cards and the profile page.
  await invalidateCatalog({ publisherSlugs: result.slugs });
  return { ok: true, data: undefined };
}

export async function createBookAction(): Promise<ActionResult<{ bookId: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const result = await createBook(getDb(), user);
  return result.ok ? { ok: true, data: { bookId: result.bookId } } : refusal(result.code);
}

export async function saveBookDraftAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = bookDraftSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await saveBookDraft(getDb(), user, parsed.data);
  return result.ok ? { ok: true, data: undefined } : refusal(result.code);
}

/** Saves the form and submits it; Section 28's rules are checked against what's stored. */
export async function submitBookAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const bookId = z.object({ bookId: z.uuid() }).safeParse(input);
  if (!bookId.success) return refusal("not_found");
  const result = await submitBook(getDb(), user, input as BookSubmissionInput);
  if (result.ok) return { ok: true, data: undefined };
  return refusal(result.code, result.fieldErrors);
}

const bookIdSchema = z.uuid();

async function bookAction(
  bookId: unknown,
  run: (user: Awaited<ReturnType<typeof requireUser>>, bookId: string) => Promise<ActionResult>,
): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = bookIdSchema.safeParse(bookId);
  if (!parsed.success) return refusal("not_found");
  return run(user, parsed.data);
}

export async function withdrawSubmissionAction(bookId: unknown): Promise<ActionResult> {
  return bookAction(bookId, async (user, id) => {
    const result = await withdrawSubmission(getDb(), user, id);
    return result.ok ? { ok: true, data: undefined } : refusal(result.code);
  });
}

export async function reviseBookAction(bookId: unknown): Promise<ActionResult> {
  return bookAction(bookId, async (user, id) => {
    const result = await reviseBook(getDb(), user, id);
    return result.ok ? { ok: true, data: undefined } : refusal(result.code);
  });
}

export async function unpublishBookAction(bookId: unknown): Promise<ActionResult> {
  return bookAction(bookId, async (user, id) => {
    const result = await unpublishBook(getDb(), user, id);
    if (!result.ok) return refusal(result.code);
    await invalidateCatalog({ bookIds: [id], publisherSlugs: [result.publisherSlug] });
    return { ok: true, data: undefined };
  });
}

export async function deleteBookDraftAction(bookId: unknown): Promise<ActionResult> {
  return bookAction(bookId, async (user, id) => {
    const result = await deleteBookDraft(getDb(), user, id);
    if (!result.ok) return refusal(result.code);
    deleteFilesLater(result.fileKeys);
    return { ok: true, data: undefined };
  });
}

export async function removeCoverAction(bookId: unknown): Promise<ActionResult> {
  return bookAction(bookId, async (user, id) => {
    const result = await removeDraftCover(getDb(), { userId: user.id, bookId: id });
    if (!result.ok) return refusal(result.code as PublishingRefusalCode);
    deleteFilesLater(result.fileKeys);
    return { ok: true, data: undefined };
  });
}
