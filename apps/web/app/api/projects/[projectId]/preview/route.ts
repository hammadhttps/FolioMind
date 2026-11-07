import { getProjectPreview } from "@foliomind/domain";
import { PROJECT_DOCUMENT_CSP, projectDocumentHtml } from "@foliomind/pdf/project";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

type Context = { params: Promise<{ projectId: string }> };

/**
 * Studio's Preview (Phase 8 skill): the same HTML the export renders, served
 * with a `sandbox` policy so it can't run a script even if it's opened directly.
 * The page shows it in a sandboxed frame.
 */
export const GET = withRateLimit(
  "authenticatedRead",
  async (_request: Request, { params }: Context) => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthenticated", "Sign in to see this.");
    const projectId = z.uuid().safeParse((await params).projectId);
    const preview = projectId.success
      ? await getProjectPreview(getDb(), user, projectId.data)
      : null;
    if (!preview) return apiError(404, "not_found", "We couldn't find that project.");

    const html = projectDocumentHtml({
      title: preview.title,
      mode: preview.mode,
      template: preview.template,
      pageSize: preview.settings.pageSize,
      cover: preview.settings.cover,
      contents: preview.settings.contents,
      audience: preview.settings.audience,
      date: new Date(),
      doc: preview.content,
      sources: preview.sources,
    });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `sandbox; ${PROJECT_DOCUMENT_CSP}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  },
);
