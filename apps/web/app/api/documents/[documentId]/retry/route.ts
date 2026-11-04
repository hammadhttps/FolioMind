import { jobStatusForOwner, retryDocument } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { deliverNow } from "@/lib/outbox";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";
import { importRefusalMessage } from "@/lib/jobs/messages";

type Context = { params: Promise<{ documentId: string }> };

/**
 * `POST /api/documents/:id/retry` (Section 11): only after a failure a retry
 * can fix, with a new operation key and job, so nothing is charged or indexed
 * twice.
 */
export const POST = withRateLimit(
  "authenticatedMutation",
  async (request: Request, { params }: Context) => {
    const refused = rejectCrossOrigin(request);
    if (refused) return refused;
    const user = await getFreshUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to do that.");
    if (user.status !== "active")
      return apiError(403, "account_inactive", "Your account can't do that right now.");

    const documentId = z.uuid().safeParse((await params).documentId);
    if (!documentId.success) return apiError(404, "not_found", "We couldn't find that document.");
    const result = await retryDocument(getDb(), { userId: user.id, documentId: documentId.data });
    if (!result.ok) {
      if (result.code === "not_found")
        return apiError(404, "not_found", "We couldn't find that document.");
      if (result.code === "not_retryable") {
        return apiError(
          409,
          "not_retryable",
          "This can't be retried. Upload the file again instead.",
        );
      }
      return apiError(409, result.code, importRefusalMessage(result.code));
    }
    await deliverNow([result.eventKey]);
    return Response.json(await jobStatusForOwner(getDb(), user.id, result.jobId), { status: 202 });
  },
);
