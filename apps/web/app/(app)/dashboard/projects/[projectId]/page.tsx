import type { Metadata } from "next";
import { PdfStudioScreen } from "@/components/foliomind/screens/pdf-studio";

export const metadata: Metadata = { title: "PDF Studio" };

/* Projects arrive in Phase 8; until then the studio shows its empty layout. */
export default async function PdfStudioPage({
  params,
}: PageProps<"/dashboard/projects/[projectId]">) {
  await params;
  return <PdfStudioScreen />;
}
