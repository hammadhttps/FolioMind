"use client";

import {
  docHasText,
  EMPTY_PROJECT_DOC,
  type ProjectDoc,
  type StudioState,
} from "@foliomind/contracts";
import { ArchiveRestore, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { setProjectArchivedAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { RenameProjectDialog } from "../projects/project-row-actions";
import { StatusAlert } from "../status-alert";
import { SectionProposals } from "../studio/section-proposals";
import type { EditorHandle } from "../studio/studio-editor";
import { StudioExport, StudioPreview } from "../studio/studio-export";
import { StudioHistory } from "../studio/studio-history";
import { StudioJob } from "../studio/studio-job";
import { StudioOutline } from "../studio/studio-outline";
import { StudioSettings } from "../studio/studio-settings";
import { StudioSources } from "../studio/studio-sources";
import { isLiveJob, useStudio } from "../studio/use-studio";

const StudioEditor = dynamic(() => import("../studio/studio-editor"), {
  ssr: false,
  loading: () => <Skeleton className="h-[640px] w-full rounded-xl" />,
});

const AI_LABEL = "AI generated, not grounded in your sources";

/**
 * PDF Studio (Section 20 #11): the "Shape your document" rail and the warm-paper
 * editor. Outline, explicit approval, draft, edits, revisions, then an export of
 * one exact revision. The editor is read-only only while a draft is being written.
 */
export function PdfStudioScreen({ initial }: { initial: StudioState }) {
  const router = useRouter();
  const studio = useStudio(initial);
  const { state, refresh, counterRef, preview } = studio;
  const editor = useRef<EditorHandle | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [doc, setDoc] = useState<ProjectDoc>(initial.content ?? EMPTY_PROJECT_DOC);

  // The poll only carries the document when it changed.
  useEffect(() => {
    if (state.content && state.revisionCounter > counterRef.current) setDoc(state.content);
  }, [state.content, state.revisionCounter, counterRef]);

  const onChange = useCallback((next: ProjectDoc) => setDoc(next), []);
  const onRevisionSaved = useCallback(() => void refresh(), [refresh]);
  const onSaved = useCallback(() => {
    // A first edit moves the status on, so the chip and the charges catch up now and then.
    if (state.status !== "editing") void refresh();
  }, [refresh, state.status]);

  const flushEditor = useCallback(async () => (await editor.current?.flush()) ?? true, []);

  const live = isLiveJob(state.job);
  const drafting = state.status === "drafting" || (live && state.job?.kind === "generate-draft");
  const hasDraft = docHasText(doc) || state.firstDraftDone;
  const sourcesBlocked =
    state.mode === "research" &&
    (state.sources.length === 0 || state.sources.some((source) => !source.available));

  async function restore() {
    const result = await setProjectArchivedAction({ projectId: state.id, archived: false }).catch(
      () => null,
    );
    if (result?.ok) {
      await refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error("We couldn't restore this project. Please try again.");
  }

  return (
    <div className="space-y-5">
      <PageHeading
        title={state.title}
        description="Describe your document, approve an outline, then edit the draft it becomes."
        actions={
          <>
            <Button variant="outline" disabled={preview} onClick={() => setRenaming(true)}>
              <Pencil aria-hidden="true" />
              Rename
            </Button>
            <StudioPreview
              state={state}
              editor={editor}
              disabled={preview || drafting || !docHasText(doc)}
            />
            <StudioExport
              studio={studio}
              editor={editor}
              disabled={preview || live || state.archived || !docHasText(doc)}
            />
          </>
        }
      />

      <RenameProjectDialog
        projectId={state.id}
        title={state.title}
        open={renaming}
        onOpenChange={setRenaming}
        onRenamed={() => {
          void refresh();
          router.refresh();
        }}
      />

      {state.archived ? (
        <StatusAlert
          tone="info"
          title="This project is archived."
          action={
            <Button size="sm" variant="outline" onClick={() => void restore()}>
              <ArchiveRestore aria-hidden="true" />
              Restore
            </Button>
          }
        >
          Restore it to keep working. You can still read it and download its exports.
        </StatusAlert>
      ) : null}

      {state.mode === "general" ? (
        <StatusAlert tone="warning" title={AI_LABEL}>
          This document is written from general knowledge and has no source citations. Check its
          facts before relying on them.
        </StatusAlert>
      ) : null}

      <StudioJob studio={studio} />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel title="Shape your document" contentClassName="space-y-5 pt-0">
            <StudioSettings
              studio={studio}
              busy={live}
              sourcesBlocked={sourcesBlocked}
              hasDraft={hasDraft}
            />
            <StudioSources studio={studio} busy={live} />
            <StudioOutline
              studio={studio}
              busy={live}
              sourcesBlocked={sourcesBlocked}
              doc={doc}
              onBeforeDraft={flushEditor}
            />
          </Panel>
          <StudioHistory studio={studio} busy={live} editor={editor} />
        </div>

        <div className="min-w-0 space-y-4">
          <SectionProposals studio={studio} doc={doc} editor={editor} />
          <StudioEditor
            projectId={state.id}
            doc={state.content ?? doc}
            counter={state.revisionCounter}
            counterRef={counterRef}
            readOnly={drafting || state.archived}
            sources={state.sources}
            handleRef={editor}
            onChange={onChange}
            onSaved={onSaved}
            onRevisionSaved={onRevisionSaved}
            preview={preview}
          />
        </div>
      </div>
    </div>
  );
}
