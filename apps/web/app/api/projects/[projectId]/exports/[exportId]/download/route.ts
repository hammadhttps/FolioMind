import { getDownloadableExport } from "@foliomind/domain";
import { z } from "zod";
import { getDb, storageFileUrl } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ projectId: string; exportId: string }> };

const fileName = (title: string) => {
  const ascii = title
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${ascii || "foliomind-export"}.pdf`;
};

/**
 * Download (Section 6 step 8): access is checked on every request, and the
 * file's storage URL never reaches the browser. On UploadThing's free plan files
 * are public behind unguessable keys, so this route is what keeps them private.
 * Anyone but the owner gets a 404.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (_request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to download this.");
    const exportId = z.uuid().safeParse((await params).exportId);
    const file = exportId.success
      ? await getDownloadableExport(getDb(), user, exportId.data)
      : null;
    if (!file) return apiError(404, "not_found", "We couldn't find that export.");

    const upstream = await fetch(storageFileUrl(file.fileKey), {
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!upstream?.ok || !upstream.body) {
      // IDs and status only (Section 6 logging rules): never the storage address.
      console.error(
        JSON.stringify({
          event: "export.download_failed",
          exportId: exportId.data,
          status: upstream?.status ?? null,
        }),
      );
      return apiError(502, "storage_unavailable", "The file couldn't be loaded. Please try again.");
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName(file.title)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        ...(upstream.headers.get("content-length")
          ? { "content-length": upstream.headers.get("content-length")! }
          : {}),
      },
    });
  },
);
