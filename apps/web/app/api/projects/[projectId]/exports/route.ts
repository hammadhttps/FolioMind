import {
  PROJECT_REFUSALS,
  projectExportRequestSchema,
  type ProjectRefusal,
} from "@foliomind/contracts";
import { requestProjectExport } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { deliverNow } from "@/lib/outbox";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

type Context = { params: Promise<{ projectId: string }> };

const REFUSAL_STATUS: Partial<Record<ProjectRefusal, number>> = {
  account_inactive: 403,
  not_found: 404,
  no_revision: 404,
  quota_reexports: 402,
  storage_limit: 402,
};

/**
 * `POST /api/projects/:id/exports` (Sections 9 and 11): queues one exact,
 * immutable revision. The same revision and template already exported hands back
 * its file with nothing queued and nothing charged.
 */
export const POST = withRateLimit("generation", async (request: Request, { params }: Context) => {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  const user = await getFreshUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to do that.");

  const projectId = z.uuid().safeParse((await params).projectId);
  if (!projectId.success) return apiError(404, "not_found", PROJECT_REFUSALS.not_found);
  const body = projectExportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "invalid", "That request wasn't valid.");

  const result = await requestProjectExport(getDb(), user, projectId.data, body.data.revisionId);
  if (!result.ok) {
    return apiError(REFUSAL_STATUS[result.code] ?? 409, result.code, PROJECT_REFUSALS[result.code]);
  }
  if (result.reused) {
    return Response.json({ exportId: result.exportId, reused: true }, { status: 200 });
  }
  await deliverNow([result.eventKey]);
  return Response.json({ exportId: result.exportId, jobId: result.jobId }, { status: 202 });
});
