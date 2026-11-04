import { checkImportUrl, IMPORT_URL_ERRORS, importUrlFormSchema } from "@foliomind/contracts";
import { requestUrlImport } from "@foliomind/domain";
import { z } from "zod";
import { env } from "@/env";
import { getDb } from "@/lib/clients";
import { importRefusalMessage } from "@/lib/jobs/messages";
import { deliverNow } from "@/lib/outbox";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

/** FolioMind's own hosts are never import targets (Section 27 step 1). */
function ownHosts(request: Request): string[] {
  const hosts = new Set([new URL(request.url).hostname, "folio-mind-two.vercel.app"]);
  if (env.APP_BASE_URL) hosts.add(new URL(env.APP_BASE_URL).hostname);
  return [...hosts];
}

/**
 * `POST /api/imports/url` (Section 27 step 2): validates the address again on
 * the server, reserves one import from the monthly allowance and records the
 * import, a Processing library entry, the job and the outbox event in one
 * transaction, then returns at once. Fails closed when Redis is down (Section 23).
 */
export const POST = withRateLimit("urlImport", async (request: Request) => {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  const user = await getFreshUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to import articles.");
  if (user.status !== "active") {
    return apiError(403, "account_inactive", importRefusalMessage("account_inactive"));
  }

  const body = importUrlFormSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      {
        error: {
          code: "invalid",
          message: "Check the highlighted fields.",
          fieldErrors: z.flattenError(body.error).fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  const checked = checkImportUrl(body.data.url, ownHosts(request));
  if (!checked.ok) {
    return Response.json(
      {
        error: {
          code: "invalid_url",
          message: IMPORT_URL_ERRORS[checked.code],
          fieldErrors: { url: [IMPORT_URL_ERRORS[checked.code]] },
        },
      },
      { status: 400 },
    );
  }

  const result = await requestUrlImport(getDb(), { userId: user.id, url: checked.url });
  if (!result.ok) {
    const status = result.code === "account_inactive" ? 403 : 409;
    return apiError(status, result.code, importRefusalMessage(result.code));
  }
  await deliverNow([result.eventKey]);
  return Response.json({ documentId: result.documentId, jobId: result.jobId }, { status: 202 });
});
