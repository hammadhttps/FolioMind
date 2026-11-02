import { getReadableDocument } from "@foliomind/domain";
import { z } from "zod";
import { getDb, storageFileUrl } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ documentId: string }> };

/** Response headers worth passing through from storage (never Content-Encoding). */
const PASS_THROUGH = ["content-length", "content-range", "last-modified", "etag"] as const;

/**
 * `GET /api/documents/:id/file` — the authorized delivery route (Sections 3 and
 * 25). Every request, including each PDF.js range request, re-checks the
 * session and document access, then streams the stored file with `Range`
 * passed through. On UploadThing's free plan files are public, so this route
 * is what keeps their storage URLs out of the browser. Inaccessible and
 * deleted documents are a 404.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to open documents.");

    const documentId = z.uuid().safeParse((await params).documentId);
    const document = documentId.success
      ? await getReadableDocument(getDb(), user, documentId.data)
      : null;
    if (!document) return apiError(404, "not_found", "We couldn't find that document.");

    const range = request.headers.get("range");
    const upstream = await fetch(storageFileUrl(document.asset.fileKey), {
      headers: range ? { range } : {},
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!upstream || (upstream.status !== 200 && upstream.status !== 206) || !upstream.body) {
      if (upstream?.status === 416) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": upstream.headers.get("content-range") ?? "" },
        });
      }
      return apiError(502, "storage_unavailable", "The file couldn't be loaded. Please try again.");
    }

    const headers = new Headers({
      "content-type": "application/pdf",
      "content-disposition": "inline",
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    for (const name of PASS_THROUGH) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
);
