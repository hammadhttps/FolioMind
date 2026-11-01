import type { Metadata } from "next";
import { ReaderScreen } from "@/components/foliomind/screens/reader";

export const metadata: Metadata = { title: "Reader" };

/* Documents and their access checks arrive in Phase 5; until then the reader shows its empty layout. */
export default async function ReaderPage({ params }: PageProps<"/read/[documentId]">) {
  await params;
  return <ReaderScreen />;
}
