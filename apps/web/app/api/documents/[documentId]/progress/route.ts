import { readingProgressSchema } from "@foliomind/contracts";
import { getReadableDocument, saveReadingProgress } from "@foliomind/domain";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ documentId: string }> };

/**
 * `POST /api/documents/:id/progress` — the Reader's last position when the page
 * is hidden or closed (`navigator.sendBeacon`, which cannot call a Server
 * Action). Ordinary saves while reading use the Server Action.
 */
const save = withRateLimit(
  "authenticatedMutation",
  async (request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to save your place.");

    const parsed = readingProgressSchema.safeParse({
      ...((await request.json().catch(() => ({}))) as object),
      documentId: (await params).documentId,
    });
    if (!parsed.success)
      return apiError(400, "invalid_request", "That reading position is invalid.");

    const document = await getReadableDocument(getDb(), user, parsed.data.documentId);
    if (!document) return apiError(404, "not_found", "We couldn't find that document.");
    await saveReadingProgress(getDb(), user, {
      versionId: document.version.id,
      pageNumber: parsed.data.pageNumber,
      position: parsed.data.position,
    });
    return new Response(null, { status: 204 });
  },
);

export async function POST(request: Request, context: Context) {
  return rejectCrossOrigin(request) ?? save(request, context);
}
