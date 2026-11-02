"use server";

import {
  createAnnotationSchema,
  readingProgressSchema,
  toggleBookmarkSchema,
  updateAnnotationSchema,
  type ActionResult,
} from "@foliomind/contracts";
import {
  createAnnotation,
  deleteAnnotation,
  getReadableDocument,
  saveReadingProgress,
  toggleBookmark,
  updateAnnotation,
  type AnnotationView,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { toAnnotationItem, type AnnotationItem } from "./view";

/*
 * Reader mutations (blueprint Sections 11 and 28). The document's current
 * version is resolved on the server after an access check; the client never
 * chooses which version it writes to.
 */

const NOT_FOUND = {
  ok: false,
  code: "not_found",
  formError: "This document isn't available anymore.",
} as const;

async function readable(documentId: string) {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return { user, limited, document: null };
  return { user, limited: null, document: await getReadableDocument(getDb(), user, documentId) };
}

const item = (annotation: AnnotationView | null): ActionResult<AnnotationItem> =>
  annotation ? { ok: true, data: toAnnotationItem(annotation) } : NOT_FOUND;

export async function createAnnotationAction(
  input: unknown,
): Promise<ActionResult<AnnotationItem>> {
  const parsed = createAnnotationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { user, limited, document } = await readable(parsed.data.documentId);
  if (limited) return limited;
  if (!document) return NOT_FOUND;
  return item(
    await createAnnotation(getDb(), user, {
      versionId: document.version.id,
      kind: parsed.data.kind,
      anchor: parsed.data.anchor,
      body: parsed.data.body,
      color: parsed.data.color,
    }),
  );
}

export async function updateAnnotationAction(
  input: unknown,
): Promise<ActionResult<AnnotationItem>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = updateAnnotationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  return item(
    await updateAnnotation(getDb(), user, parsed.data.annotationId, {
      body: parsed.data.body,
      color: parsed.data.color,
    }),
  );
}

export async function deleteAnnotationAction(annotationId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const id = z.uuid().safeParse(annotationId);
  if (!id.success) return NOT_FOUND;
  return (await deleteAnnotation(getDb(), user, id.data))
    ? { ok: true, data: undefined }
    : NOT_FOUND;
}

export async function toggleBookmarkAction(
  input: unknown,
): Promise<ActionResult<{ bookmarked: boolean; annotation: AnnotationItem | null }>> {
  const parsed = toggleBookmarkSchema.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const { user, limited, document } = await readable(parsed.data.documentId);
  if (limited) return limited;
  if (!document) return NOT_FOUND;
  const result = await toggleBookmark(getDb(), user, {
    versionId: document.version.id,
    pageNumber: parsed.data.pageNumber,
  });
  if (!result) return NOT_FOUND;
  return {
    ok: true,
    data: {
      bookmarked: result.bookmarked,
      annotation: result.annotation ? toAnnotationItem(result.annotation) : null,
    },
  };
}

/** Debounced saves while reading; the page-hide save uses the progress route. */
export async function saveProgressAction(input: unknown): Promise<ActionResult> {
  const parsed = readingProgressSchema.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const { user, limited, document } = await readable(parsed.data.documentId);
  if (limited) return limited;
  if (!document) return NOT_FOUND;
  await saveReadingProgress(getDb(), user, {
    versionId: document.version.id,
    pageNumber: parsed.data.pageNumber,
    position: parsed.data.position,
  });
  return { ok: true, data: undefined };
}
