import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import { globalSearch } from "@foliomind/domain";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/request-guard";
import { getCurrentUser } from "@/lib/session";

const query = z.string().trim().min(SEARCH_MIN_LENGTH).max(SEARCH_MAX_LENGTH);

/**
 * `GET /api/search?q=` — the ⌘K dialog's content search (Section 20 shared
 * interactions). Permission-filtered: the public catalog plus the signed-in
 * user's own library and projects. Rate limited as catalog search (Section 23).
 */
export const GET = withRateLimit("publicCatalog", async (request: Request) => {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") {
    return apiError(401, "unauthenticated", "Sign in to search.");
  }
  const parsed = query.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) {
    return Response.json({ books: [], publishers: [], library: [], projects: [] });
  }
  const results = await globalSearch(getDb(), user, parsed.data);
  return Response.json(results, { headers: { "cache-control": "private, no-store" } });
});
