import { isAdmin, submissionSourceFile } from "@foliomind/domain";
import { z } from "zod";
import { getDb, storageFileUrl } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

type Context = { params: Promise<{ revisionId: string }> };

const PASS_THROUGH = ["content-length", "content-range", "last-modified", "etag"] as const;

/**
 * `GET /api/admin/submissions/:revisionId/source` — a moderator opens the PDF
 * of a submitted, public-bound revision (Section 4: admins may review public
 * submissions, never private uploads). Drafts and private files are a 404.
 * The account is re-read from Postgres on every request.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (request: Request, { params }: Context) => {
    const admin = await getFreshUser();
    if (!admin) return apiError(401, "unauthenticated", "Sign in to continue.");
    if (!isAdmin(admin)) return apiError(403, "forbidden", "Only administrators can do this.");

    const revisionId = z.uuid().safeParse((await params).revisionId);
    const file = revisionId.success ? await submissionSourceFile(getDb(), revisionId.data) : null;
    if (!file) return apiError(404, "not_found", "We couldn't find that submission.");

    const range = request.headers.get("range");
    const upstream = await fetch(storageFileUrl(file.fileKey), {
      headers: range ? { range } : {},
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!upstream || (upstream.status !== 200 && upstream.status !== 206) || !upstream.body) {
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
