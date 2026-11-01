import type { Metadata } from "next";
import { ResearchWorkspaceScreen } from "@/components/foliomind/screens/research-workspace";

export const metadata: Metadata = { title: "Research workspace" };

/* Workspaces arrive in Phase 7; until then the page shows its empty layout. */
export default async function ResearchWorkspacePage({
  params,
}: PageProps<"/dashboard/research/[workspaceId]">) {
  await params;
  return <ResearchWorkspaceScreen />;
}
