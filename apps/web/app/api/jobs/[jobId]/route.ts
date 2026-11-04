import { jobStatusForOwner } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ jobId: string }> };

/**
 * `GET /api/jobs/:id` (Section 11): the owner's safe view of a job (status,
 * phase, progress, safe error code). Anyone else gets a 404.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (_request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to see this.");
    const jobId = z.uuid().safeParse((await params).jobId);
    const status = jobId.success ? await jobStatusForOwner(getDb(), user.id, jobId.data) : null;
    if (!status) return apiError(404, "not_found", "We couldn't find that job.");
    return Response.json(status, { headers: { "cache-control": "private, no-store" } });
  },
);
