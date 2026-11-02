import { LIBRARY_PAGE_SIZE, librarySearchParamsSchema } from "@foliomind/contracts/search-params";
import { listCollections, listLibrary, uploadAllowance } from "@foliomind/domain";
import type { Metadata } from "next";
import { MyLibraryScreen } from "@/components/foliomind/screens/my-library";
import { getDb } from "@/lib/clients";
import { toLibraryCard } from "@/lib/library/view";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My Library" };

/** The first page for the URL's filters; Load more continues with the returned cursor. */
export default async function MyLibraryPage({ searchParams }: PageProps<"/dashboard/library">) {
  const user = await requireUser();
  const params = librarySearchParamsSchema.parse(await searchParams);
  const db = getDb();
  const [page, collections, allowance] = await Promise.all([
    listLibrary(db, {
      userId: user.id,
      q: params.q,
      type: params.type,
      status: params.status,
      collectionId: params.collection,
      sort: params.sort,
      limit: LIBRARY_PAGE_SIZE,
    }),
    listCollections(db, user.id),
    uploadAllowance(db, user.id),
  ]);

  return (
    <MyLibraryScreen
      initial={{ items: page.items.map(toLibraryCard), nextCursor: page.nextCursor }}
      collections={collections}
      allowance={allowance}
    />
  );
}
