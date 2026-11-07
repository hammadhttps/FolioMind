import {
  PROJECT_REFUSALS,
  projectGenerateRequestSchema,
  type ProjectRefusal,
} from "@foliomind/contracts";
import { requestProjectGeneration } from "@foliomind/domain";
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
  quota_projects: 402,
  quota_regenerations: 402,
};

/**
 * `POST /api/projects/:id/generate` (Sections 9 and 11): checks the project and
 * its sources, reserves the allowance, writes the job and the outbox event
 * together, then returns at once. Worker B does the rest.
 */
export const POST = withRateLimit("generation", async (request: Request, { params }: Context) => {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  const user = await getFreshUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to do that.");

  const projectId = z.uuid().safeParse((await params).projectId);
  if (!projectId.success) return apiError(404, "not_found", PROJECT_REFUSALS.not_found);
  const body = projectGenerateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "invalid", "That request wasn't valid.");

  const result = await requestProjectGeneration(getDb(), user, projectId.data, body.data);
  if (!result.ok) {
    return apiError(REFUSAL_STATUS[result.code] ?? 409, result.code, PROJECT_REFUSALS[result.code]);
  }
  await deliverNow([result.eventKey]);
  return Response.json({ jobId: result.jobId }, { status: 202 });
});
