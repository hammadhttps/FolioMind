"use server";

import {
  collectionFormSchema,
  renameDocumentSchema,
  type ActionResult,
  type CollectionFormValues,
} from "@foliomind/contracts";
import { LIBRARY_PAGE_SIZE, librarySearchParamsSchema } from "@foliomind/contracts/search-params";
import {
  createCollection,
  deleteCollection,
  deleteDocument,
  listLibrary,
  markAssetsDeleted,
  renameDocument,
  requestReimport,
  setCollectionMembership,
  updateCollection,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { getDb, getUtApi } from "@/lib/clients";
import { importRefusalMessage } from "@/lib/jobs/messages";
import { deliverNow } from "@/lib/outbox";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { toLibraryCard, type LibraryCard } from "./view";

/*
 * My Library mutations (blueprint Sections 11 and 28). Every action re-parses
 * its input, checks ownership in the domain service and is rate limited as an
 * authenticated mutation. Next.js checks each Server Action's Origin.
 */

async function guard() {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  return { user, limited };
}

const NOT_FOUND = {
  ok: false,
  code: "not_found",
  formError: "We couldn't find that item.",
} as const;
const invalid = (error: z.ZodError) =>
  ({ ok: false, code: "invalid", fieldErrors: z.flattenError(error).fieldErrors }) as const;

export async function renameDocumentAction(
  input: unknown,
): Promise<ActionResult<{ title: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = renameDocumentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const renamed = await renameDocument(getDb(), user, parsed.data.documentId, parsed.data.title);
  return renamed ? { ok: true, data: { title: parsed.data.title } } : NOT_FOUND;
}

/**
 * Access stops in Postgres first; the stored file is then removed right after
 * the response, because UploadThing's free plan keeps files public. Files that
 * fail to delete stay `deleting` for the Phase 6 cleanup.
 */
export async function deleteDocumentAction(documentId: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(documentId);
  if (!id.success) return NOT_FOUND;
  const revoked = await deleteDocument(getDb(), user, id.data);
  if (!revoked) return NOT_FOUND;
  if (revoked.fileKeys.length > 0) {
    after(async () => {
      const removed = await getUtApi()
        .deleteFiles(revoked.fileKeys)
        .then((result) => result.success)
        .catch(() => false);
      if (removed) await markAssetsDeleted(getDb(), revoked.fileKeys);
    });
  }
  return { ok: true, data: undefined };
}

/**
 * Re-import (Section 27 step 8): a new snapshot of the article becomes a new
 * version; the current one stays readable until the new one is ready. Uses the
 * import rate limit and monthly allowance.
 */
export async function reimportDocumentAction(
  documentId: unknown,
): Promise<ActionResult<{ jobId: string }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("urlImport", await headers());
  if (limited) return limited;
  const id = z.uuid().safeParse(documentId);
  if (!id.success) return NOT_FOUND;
  const result = await requestReimport(getDb(), { userId: user.id, documentId: id.data });
  if (!result.ok) {
    return result.code === "not_found"
      ? NOT_FOUND
      : { ok: false, code: result.code, formError: importRefusalMessage(result.code) };
  }
  await deliverNow([result.eventKey]);
  return { ok: true, data: { jobId: result.jobId } };
}

const nameTaken = (): ActionResult<never> => ({
  ok: false,
  code: "name_taken",
  fieldErrors: { name: ["You already have a collection with that name."] },
});

export async function createCollectionAction(
  input: CollectionFormValues,
): Promise<ActionResult<{ id: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = collectionFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await createCollection(getDb(), user, parsed.data);
  if (result.ok) return { ok: true, data: { id: result.id } };
  return result.code === "name_taken" ? nameTaken() : NOT_FOUND;
}

export async function updateCollectionAction(
  collectionId: unknown,
  input: CollectionFormValues,
): Promise<ActionResult<{ id: string }>> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(collectionId);
  const parsed = collectionFormSchema.safeParse(input);
  if (!id.success) return NOT_FOUND;
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateCollection(getDb(), user, id.data, parsed.data);
  if (result.ok) return { ok: true, data: { id: result.id } };
  return result.code === "name_taken" ? nameTaken() : NOT_FOUND;
}

/** Removes the collection only; its documents stay in the library. */
export async function deleteCollectionAction(collectionId: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const id = z.uuid().safeParse(collectionId);
  if (!id.success) return NOT_FOUND;
  return (await deleteCollection(getDb(), user, id.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

const membershipSchema = z.object({
  collectionId: z.uuid(),
  libraryItemId: z.uuid(),
  member: z.boolean(),
});

export async function setCollectionMembershipAction(input: unknown): Promise<ActionResult> {
  const { user, limited } = await guard();
  if (limited) return limited;
  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  return (await setCollectionMembership(getDb(), user, parsed.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

/** "Load more" (Section 24 keyset strategy): the next page for the same URL filters. */
export async function loadMoreLibraryAction(
  params: Record<string, string | undefined>,
  cursor: string,
): Promise<ActionResult<{ items: LibraryCard[]; nextCursor: string | null }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedRead", await headers());
  if (limited) return limited;
  const filters = librarySearchParamsSchema.parse(params);
  const page = await listLibrary(getDb(), {
    userId: user.id,
    q: filters.q,
    type: filters.type,
    status: filters.status,
    collectionId: filters.collection,
    sort: filters.sort,
    cursor: z.string().max(400).parse(cursor),
    limit: LIBRARY_PAGE_SIZE,
  });
  return { ok: true, data: { items: page.items.map(toLibraryCard), nextCursor: page.nextCursor } };
}
