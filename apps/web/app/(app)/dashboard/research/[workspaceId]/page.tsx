import { getWorkspaceDetail, questionAllowance } from "@foliomind/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ResearchWorkspaceScreen } from "@/components/foliomind/screens/research-workspace";
import { getDb } from "@/lib/clients";
import { requireUser } from "@/lib/session";
import { toNoteView } from "@/lib/workspaces/view";

export const metadata: Metadata = { title: "Research workspace", robots: { index: false } };

/**
 * Research Workspace (Section 20 #9). Ownership is checked on the server, and
 * anything else is a 404, so another user's workspace can't be told apart from
 * one that doesn't exist.
 */
export default async function ResearchWorkspacePage({
  params,
}: PageProps<"/dashboard/research/[workspaceId]">) {
  const user = await requireUser();
  const workspaceId = z.uuid().safeParse((await params).workspaceId);
  if (!workspaceId.success) notFound();

  const db = getDb();
  const [workspace, allowance] = await Promise.all([
    getWorkspaceDetail(db, user, workspaceId.data),
    questionAllowance(db, user.id),
  ]);
  if (!workspace) notFound();

  return (
    <ResearchWorkspaceScreen
      // Rename and new sources refresh these props; the notes and chat keep their own state.
      workspace={{ ...workspace, notes: workspace.notes.map(toNoteView), allowance }}
    />
  );
}
