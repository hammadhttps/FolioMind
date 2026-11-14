import { publisherBooksSearchParamsSchema } from "@foliomind/contracts/search-params";
import { followState, savedBookIds } from "@foliomind/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FollowButton } from "@/components/foliomind/catalog/follow-button";
import { PublicPage } from "@/components/foliomind/public-page";
import { PublisherProfileScreen } from "@/components/foliomind/screens/publisher-profile";
import { loadPublicPublisher, loadPublisherBooks } from "@/lib/catalog/data";
import { getDb } from "@/lib/clients";
import { getSessionUser } from "@/lib/session";

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export async function generateMetadata({
  params,
}: PageProps<"/publishers/[slug]">): Promise<Metadata> {
  const publisher = await loadPublicPublisher((await params).slug);
  if (!publisher) return { title: "Publisher not found", robots: { index: false } };
  return {
    title: publisher.name,
    description: clip(publisher.bio.replace(/\s+/g, " "), 160),
    alternates: { canonical: `/publishers/${publisher.slug}` },
  };
}

/**
 * Publisher Profile (Section 5 row 4): approved publishers only. The profile
 * and its book grid are cached under `publisher:{slug}`; following and saved
 * state are read per request.
 */
export default async function PublisherPage({
  params,
  searchParams,
}: PageProps<"/publishers/[slug]">) {
  const { slug } = await params;
  const publisher = await loadPublicPublisher(slug);
  if (!publisher) notFound();
  const query = publisherBooksSearchParamsSchema.parse(await searchParams);
  const [data, user] = await Promise.all([loadPublisherBooks(slug, query), getSessionUser()]);
  const savedIds = user
    ? await savedBookIds(
        getDb(),
        user.id,
        data.books.map((book) => book.id),
      )
    : [];
  return (
    <PublicPage>
      <PublisherProfileScreen
        publisher={publisher}
        books={data.books}
        total={data.total}
        categories={data.categories}
        params={query}
        viewer={{ signedIn: Boolean(user), savedIds }}
        follow={
          <Suspense fallback={null}>
            <Follow publisherId={publisher.id} name={publisher.name} slug={slug} />
          </Suspense>
        }
      />
    </PublicPage>
  );
}

async function Follow({
  publisherId,
  name,
  slug,
}: {
  publisherId: string;
  name: string;
  slug: string;
}) {
  const user = await getSessionUser();
  const state = user ? await followState(getDb(), user.id, publisherId) : null;
  if (state?.isOwner) return null;
  return (
    <FollowButton
      publisherId={publisherId}
      name={name}
      initial={{ following: state?.following ?? false, notify: state?.notify ?? true }}
      signedIn={Boolean(user)}
      returnTo={`/publishers/${slug}`}
    />
  );
}
