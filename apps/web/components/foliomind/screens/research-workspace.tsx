"use client";

import type { MessageView, QuestionAllowance, ThreadView } from "@foliomind/contracts";
import { CircleOff, FilePlus2, Library, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import {
  createProjectFromWorkspaceAction,
  removeWorkspaceSourceAction,
  saveAnswerToNotesAction,
} from "@/lib/workspaces/actions";
import type { NoteView } from "@/lib/workspaces/view";
import { ChatConversation } from "../chat/chat-conversation";
import { useOpenCitation } from "../chat/use-open-citation";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { NotesPanel } from "../research/notes-panel";
import { SourcePickerDialog } from "../research/source-picker";
import { DeleteWorkspaceDialog, WorkspaceFormDialog } from "../research/workspace-dialogs";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";

export interface WorkspaceSourceItem {
  versionId: string;
  documentId: string | null;
  title: string;
  available: boolean;
  superseded: boolean;
}

export interface WorkspaceScreenData {
  id: string;
  name: string;
  description: string | null;
  sources: WorkspaceSourceItem[];
  notes: NoteView[];
  threads: ThreadView[];
  allowance: QuestionAllowance | null;
  sourceLimit: number;
  planCode: string;
}

/**
 * Research Workspace detail (Section 20 #9): a narrow source rail with
 * checkboxes under the plan's cap, auto-saved notes and a broad chat. Revoked
 * sources stay listed as unavailable and no longer take part in anything.
 */
export function ResearchWorkspaceScreen({ workspace }: { workspace: WorkspaceScreenData }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState(false);
  // Unticked sources are remembered, so a newly added source starts ticked.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState(workspace.notes);
  const [creating, startCreating] = useTransition();
  const openCitation = useOpenCitation();

  const available = workspace.sources.filter((source) => source.available);
  const selected = useMemo(
    () =>
      workspace.sources
        .filter((source) => source.available && !unticked.has(source.versionId))
        .map((source) => source.versionId),
    [workspace.sources, unticked],
  );
  const savedAnswers = useMemo(
    () => new Set(notes.flatMap((note) => (note.sourceMessageId ? [note.sourceMessageId] : []))),
    [notes],
  );
  const remaining = workspace.sourceLimit - workspace.sources.length;

  const unavailableReason =
    available.length === 0
      ? "Add ready sources to ask questions across them."
      : selected.length === 0
        ? "Select at least one source to ask a question."
        : null;

  function toggle(versionId: string, checked: boolean) {
    setUnticked((current) => {
      const next = new Set(current);
      if (checked) next.delete(versionId);
      else next.add(versionId);
      return next;
    });
  }

  async function removeSource(source: WorkspaceSourceItem) {
    if (preview) return;
    const result = await removeWorkspaceSourceAction({
      workspaceId: workspace.id,
      versionId: source.versionId,
    }).catch(() => null);
    if (result?.ok) {
      router.refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error(result?.formError ?? "We couldn't remove that source. Please try again.");
  }

  async function saveAnswer(message: MessageView) {
    if (preview) return;
    const result = await saveAnswerToNotesAction({
      workspaceId: workspace.id,
      messageId: message.id,
    }).catch(() => null);
    if (result?.ok) {
      setNotes((current) =>
        current.some((note) => note.id === result.data.id) ? current : [result.data, ...current],
      );
      toast.success("Saved to your notes.");
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error(result?.formError ?? "We couldn't save that to your notes.");
  }

  function turnIntoPdf() {
    if (preview) return;
    startCreating(async () => {
      const result = await createProjectFromWorkspaceAction({
        workspaceId: workspace.id,
        versionIds: selected,
      }).catch(() => null);
      if (result?.ok) {
        router.push(`/dashboard/projects/${result.data.projectId}`);
        return;
      }
      if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
      else toast.error(result?.formError ?? "We couldn't create the project. Please try again.");
    });
  }

  return (
    <div className="space-y-5">
      <PageHeading
        title={workspace.name}
        description={
          workspace.description ?? "Compare your sources and keep your findings together."
        }
        actions={
          <>
            <Button variant="outline" disabled={preview} onClick={() => setRenaming(true)}>
              <Pencil aria-hidden="true" />
              Rename
            </Button>
            <Button variant="ghost" disabled={preview} onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
            <Button disabled={selected.length === 0 || creating || preview} onClick={turnIntoPdf}>
              {creating ? <Spinner aria-hidden="true" /> : <FilePlus2 aria-hidden="true" />}
              Turn into a PDF
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Sources"
            description={`${workspace.sources.length} of ${workspace.sourceLimit} on your plan. Ticked sources answer questions.`}
            contentClassName="pt-0"
          >
            {workspace.sources.length === 0 ? (
              <EmptyState
                variant="plain"
                className="px-0 py-4"
                icon={Library}
                title="No sources yet."
                description="Add ready documents from your library to compare them here."
              />
            ) : (
              <ul className="space-y-1.5" aria-label="Workspace sources">
                {workspace.sources.map((source) => (
                  <SourceRow
                    key={source.versionId}
                    source={source}
                    checked={selected.includes(source.versionId)}
                    onToggle={(checked) => toggle(source.versionId, checked)}
                    onRemove={() => void removeSource(source)}
                    onOpen={() => void openCitation({ versionId: source.versionId, pageStart: 1 })}
                  />
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2">
              <Button
                variant="outline"
                size="sm"
                disabled={preview || remaining <= 0}
                onClick={() => setPicking(true)}
              >
                <Plus aria-hidden="true" />
                Add sources
              </Button>
              {remaining <= 0 ? (
                <StatusAlert tone="info">
                  You&apos;ve reached {workspace.sourceLimit} sources on the{" "}
                  {workspace.planCode === "pro" ? "Pro" : "Free"} plan. Remove one to add another
                  {workspace.planCode === "pro" ? (
                    "."
                  ) : (
                    <>
                      , or{" "}
                      <Link href="/pricing" className="underline underline-offset-2">
                        compare plans
                      </Link>
                      .
                    </>
                  )}
                </StatusAlert>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Notes"
            description="Saved automatically as you write."
            contentClassName="pt-0"
          >
            <NotesPanel workspaceId={workspace.id} notes={notes} onNotesChange={setNotes} />
          </Panel>
        </div>

        <ChatConversation
          scope={{ kind: "workspace", workspaceId: workspace.id }}
          title="Ask across your sources"
          description="Answers cite each source and page."
          unavailableReason={unavailableReason}
          sourceVersionIds={selected.length > 0 ? selected : undefined}
          suggestedPrompts={[
            "What are the key ideas across these sources?",
            "Where do these sources agree or disagree?",
            "How could I apply these ideas in practice?",
          ]}
          threads={workspace.threads}
          allowance={workspace.allowance}
          onOpenCitation={(citation) => void openCitation(citation)}
          onSaveToNotes={(message) => void saveAnswer(message)}
          savedMessageIds={savedAnswers}
          abstainHelp={
            remaining > 0 ? (
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setPicking(true)}
              >
                Add a source that covers this
              </button>
            ) : null
          }
          className="h-[80dvh] min-h-[480px] lg:sticky lg:top-24 lg:h-[calc(100dvh-8rem)] lg:min-h-[600px]"
        />
      </div>

      <WorkspaceFormDialog
        open={renaming}
        onOpenChange={setRenaming}
        workspace={workspace}
        onUpdated={() => router.refresh()}
      />
      <DeleteWorkspaceDialog
        workspace={deleting ? workspace : null}
        onOpenChange={setDeleting}
        onDeleted={() => router.push("/dashboard?tab=research")}
      />
      <SourcePickerDialog
        workspaceId={workspace.id}
        open={picking}
        onOpenChange={setPicking}
        remaining={remaining}
        limit={workspace.sourceLimit}
        onAdded={() => router.refresh()}
      />
    </div>
  );
}

function SourceRow({
  source,
  checked,
  onToggle,
  onRemove,
  onOpen,
}: {
  source: WorkspaceSourceItem;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const checkboxId = `source-${source.versionId}`;
  return (
    <li className="flex items-start gap-2.5 rounded-lg border bg-background px-2.5 py-2">
      {source.available ? (
        <Checkbox
          id={checkboxId}
          checked={checked}
          className="mt-0.5"
          onCheckedChange={(value) => onToggle(value === true)}
          aria-label={`Use ${source.title} for answers`}
        />
      ) : (
        <CircleOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        {source.available ? (
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/70"
          >
            {source.title}
          </button>
        ) : (
          <p className="truncate text-sm font-medium text-muted-foreground">{source.title}</p>
        )}
        {!source.available ? (
          <p className="text-xs text-muted-foreground">No longer available. It isn&apos;t used.</p>
        ) : source.superseded ? (
          <p className="text-xs text-muted-foreground">
            A newer version exists. Remove and add it again to use the new one.
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="-my-1 -mr-1"
        aria-label={`Remove ${source.title} from this workspace`}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}
