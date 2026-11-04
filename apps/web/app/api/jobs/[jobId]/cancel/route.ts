import { jobStatusForOwner, requestJobCancel } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { deliverNow } from "@/lib/outbox";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

type Context = { params: Promise<{ jobId: string }> };

/**
 * `POST /api/jobs/:id/cancel` (Section 9): marks the job cancelled and sends
 * the cancellation event, so the run stops between steps.
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

    const jobId = z.uuid().safeParse((await params).jobId);
    if (!jobId.success) return apiError(404, "not_found", "We couldn't find that job.");
    const cancelled = await requestJobCancel(getDb(), user.id, jobId.data);
    if (!cancelled) {
      const exists = await jobStatusForOwner(getDb(), user.id, jobId.data);
      return exists
        ? apiError(409, "not_cancellable", "This has already finished.")
        : apiError(404, "not_found", "We couldn't find that job.");
    }
    await deliverNow([cancelled.eventKey]);
    return Response.json(await jobStatusForOwner(getDb(), user.id, jobId.data));
  },
);
