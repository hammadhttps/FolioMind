import { PUBLISHING_PAGE_SIZE } from "@foliomind/contracts";
import { publishingSearchParamsSchema } from "@foliomind/contracts/search-params";
import {
  getPublisherAccount,
  getPublisherBook,
  isAdmin,
  listCategories,
  listPublisherBooks,
  publisherStats,
} from "@foliomind/domain";
import type { Metadata } from "next";
import { PublishingScreen, type PublishingState } from "@/components/foliomind/screens/publishing";
import { getDb } from "@/lib/clients";
import { toAccountView, toBookEditorView, toBookRowView } from "@/lib/publishing/view";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Publishing" };

/**
 * Publisher Dashboard (Section 5 row 12). Who sees what is decided here on the
 * server from the stored role and profile; the domain re-checks both on every
 * mutation.
 */
export default async function PublishingPage({ searchParams }: PageProps<"/dashboard/publishing">) {
  const user = await requireUser();
  const params = publishingSearchParamsSchema.parse(await searchParams);
  const db = getDb();
  const account = await getPublisherAccount(db, user.id);
  const approved = user.role === "publisher" && account.profile?.status === "approved";
  const accountView = toAccountView(account);

  let state: PublishingState;
  if (!approved || !account.profile) {
    state = {
      kind: "apply",
      account: accountView,
      emailVerified: user.emailVerified,
      isAdmin: isAdmin(user),
    };
  } else if (params.book) {
    const [book, categories] = await Promise.all([
      getPublisherBook(db, user, params.book),
      listCategories(db),
    ]);
    state = book
      ? { kind: "book", book: toBookEditorView(book), categories }
      : { kind: "missing-book" };
  } else if (params.tab === "stats") {
    state = {
      kind: "stats",
      account: accountView,
      stats: await publisherStats(db, account.profile.id),
    };
  } else if (params.tab === "profile") {
    state = { kind: "profile", account: accountView };
  } else {
    const page = await listPublisherBooks(db, {
      publisherId: account.profile.id,
      q: params.q,
      status: params.status,
      after: params.after,
      before: params.before,
      limit: PUBLISHING_PAGE_SIZE,
    });
    state = {
      kind: "books",
      account: accountView,
      page: {
        items: page.items.map(toBookRowView),
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
      },
    };
  }
  return <PublishingScreen state={state} />;
}
