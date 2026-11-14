import { catalogSearchParamsSchema } from "@foliomind/contracts/search-params";
import { savedBookIds } from "@foliomind/domain";
import type { Metadata } from "next";
import { PublicPage } from "@/components/foliomind/public-page";
import { ExploreScreen } from "@/components/foliomind/screens/explore";
import { loadExplore } from "@/lib/catalog/data";
import { getDb } from "@/lib/clients";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Explore the library",
  description: "Browse books that independent publishers share on FolioMind.",
  alternates: { canonical: "/library" },
};

/**
 * Explore (Sections 5 row 2 and 24): the URL's params, parsed with the shared
 * schema (a malformed URL falls back to defaults), drive a cached catalog
 * query. Signed-in readers also see which results they've saved.
 */
export default async function ExplorePage({ searchParams }: PageProps<"/library">) {
  const params = catalogSearchParamsSchema.parse(await searchParams);
  const [data, user] = await Promise.all([loadExplore(params), getSessionUser()]);
  const savedIds = user
    ? await savedBookIds(
        getDb(),
        user.id,
        data.books.map((book) => book.id),
      )
    : [];
  return (
    <PublicPage>
      <ExploreScreen data={data} params={params} viewer={{ signedIn: Boolean(user), savedIds }} />
    </PublicPage>
  );
}
