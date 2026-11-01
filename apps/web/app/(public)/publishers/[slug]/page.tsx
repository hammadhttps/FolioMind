import { notFound } from "next/navigation";

/*
 * Publisher Profile. Approved publishers arrive in Phase 9, so no slug resolves
 * yet; the layout lives in PublisherProfileScreen (see /dev/ui).
 */
export default async function PublisherPage({ params }: PageProps<"/publishers/[slug]">) {
  await params;
  notFound();
}
