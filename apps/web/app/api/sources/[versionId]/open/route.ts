import { openSource } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

const pageSchema = z.coerce.number().int().min(1).max(100_000).catch(1);

/**
 * Opening a citation (Section 8 step 8) checks access again. A source that was
 * removed or revoked reads as unavailable, and a replaced version is reported
 * rather than silently showing the newer pages.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (request: Request, { params }: { params: Promise<{ versionId: string }> }) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to open this source.");
    const versionId = z.uuid().safeParse((await params).versionId);
    if (!versionId.success || user.status !== "active") {
      return Response.json({ available: false, reason: "removed", documentId: null });
    }
    const page = pageSchema.parse(new URL(request.url).searchParams.get("page"));
    return Response.json(await openSource(getDb(), user, versionId.data, page), {
      headers: { "Cache-Control": "private, no-store" },
    });
  },
);
