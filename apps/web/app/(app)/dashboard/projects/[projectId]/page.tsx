import { getStudioState } from "@foliomind/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PdfStudioScreen } from "@/components/foliomind/screens/pdf-studio";
import { getDb } from "@/lib/clients";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "PDF Studio", robots: { index: false } };

/**
 * PDF Studio (Section 20 #11). Ownership is checked on the server, and anything
 * else is a 404, so another user's project can't be told apart from one that
 * doesn't exist.
 */
export default async function PdfStudioPage({
  params,
}: PageProps<"/dashboard/projects/[projectId]">) {
  const user = await requireUser();
  const projectId = z.uuid().safeParse((await params).projectId);
  if (!projectId.success) notFound();
  const state = await getStudioState(getDb(), user, projectId.data);
  if (!state) notFound();
  return <PdfStudioScreen initial={state} />;
}
