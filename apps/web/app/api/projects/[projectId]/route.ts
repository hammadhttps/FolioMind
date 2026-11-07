import { getStudioState } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ projectId: string }> };

/**
 * `GET /api/projects/:id` (Section 11): the owner's Studio state, polled while a
 * job runs. Anyone else gets a 404. `?counter=` leaves out a document the
 * client already holds.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to see this.");
    const projectId = z.uuid().safeParse((await params).projectId);
    const counter = z.coerce
      .number()
      .int()
      .nonnegative()
      .safeParse(new URL(request.url).searchParams.get("counter") ?? undefined);
    const state = projectId.success
      ? await getStudioState(getDb(), user, projectId.data, {
          knownCounter: counter.success ? counter.data : undefined,
        })
      : null;
    if (!state) return apiError(404, "not_found", "We couldn't find that project.");
    return Response.json(state, { headers: { "cache-control": "private, no-store" } });
  },
);
