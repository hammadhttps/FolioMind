import "server-only";
import { bumpCatalogVersion } from "@foliomind/domain";
import { updateTag } from "next/cache";
import { getCacheKeys, getRequestRedis } from "@/lib/clients";
import { catalogTags } from "./data";

/**
 * After approve, unpublish, takedown or a publisher profile edit (Section 23):
 * bump the Upstash catalog version, orphaning every cached result and facet
 * list, and expire the Next.js tags at once so the change is visible on the
 * next request. Server Actions only (`updateTag`).
 */
export async function invalidateCatalog({
  bookIds = [],
  publisherSlugs = [],
}: {
  bookIds?: readonly string[];
  publisherSlugs?: readonly string[];
}): Promise<void> {
  await bumpCatalogVersion(getRequestRedis(), getCacheKeys());
  updateTag(catalogTags.catalog);
  for (const id of new Set(bookIds)) updateTag(catalogTags.book(id));
  for (const slug of new Set(publisherSlugs)) updateTag(catalogTags.publisher(slug));
}
