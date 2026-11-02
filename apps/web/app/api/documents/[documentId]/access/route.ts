import { getReadableDocument } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ documentId: string }> };

/**
 * `GET /api/documents/:id/access` — re-checks access to the document's current
 * version and answers with where to read it (Section 25). UploadThing's free
 * plan has no private files, so the answer is FolioMind's authorized streaming
 * route rather than a signed storage URL; callers do not need to know which.
 * Anything the caller cannot read, deleted documents included, is a 404.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (_request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to open documents.");

    const documentId = z.uuid().safeParse((await params).documentId);
    const document = documentId.success
      ? await getReadableDocument(getDb(), user, documentId.data)
      : null;
    if (!document) return apiError(404, "not_found", "We couldn't find that document.");

    return Response.json(
      { url: `/api/documents/${document.id}/file`, versionId: document.version.id },
      { headers: { "cache-control": "private, no-store" } },
    );
  },
);
