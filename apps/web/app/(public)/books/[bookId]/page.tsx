import { notFound } from "next/navigation";

/*
 * Book Details. Approved catalog books arrive in Phase 9, so no ID resolves yet
 * and every request is a 404; the layout lives in BookDetailsScreen (see /dev/ui).
 */
export default async function BookPage({ params }: PageProps<"/books/[bookId]">) {
  await params;
  notFound();
}
