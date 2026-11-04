"use client";

import { isTerminalJobStatus, noteBodySchema, type HighlightColor } from "@foliomind/contracts";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, StickyNote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import {
  createAnnotationAction,
  deleteAnnotationAction,
  toggleBookmarkAction,
  updateAnnotationAction,
} from "@/lib/reader/actions";
import type { AnnotationItem } from "@/lib/reader/view";
import { AppDialog } from "../app-dialog";
import { ChatPanel } from "../chat-panel";
import { PageHeading } from "../page-heading";
import { fetchJob, jobQueryKey } from "../processing-status";
import { AnnotationsPanel } from "../reader/annotations-panel";
import type { SelectionAnchor } from "../reader/anchors";
import { PdfReader, type ReaderApi, type SavedPosition } from "../reader/pdf-reader";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";
import { StatusChip } from "../status-chip";

export interface ReaderDocument {
  id: string;
  title: string;
  status: "ready" | "processing" | "attention";
  /** The owner's latest processing job, if any. */
  job?: { id: string; live: boolean; errorMessage: string | null; canRetry: boolean } | null;
}

const WIDE = "(min-width: 981px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

type Failure = { code?: string; formError?: string; retryAfterSeconds?: number } | null;
function reportFailure(result: Failure, fallback: string) {
  if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
  else toast.error(result?.formError ?? fallback);
}

let pendingId = 0;

/**
 * Reader (Section 20 #8): the PDF.js document beside a panel with the reader's
 * notes and the AI tab. Side by side and resizable from 981px, stacked below
 * (Section 19). AI becomes available after ingestion (Phases 6 and 7).
 */
export function ReaderScreen({
  document,
  annotations: initialAnnotations,
  progress,
}: {
  document: ReaderDocument;
  annotations: AnnotationItem[];
  progress: SavedPosition | null;
}) {
  const preview = useIsPreview();
  const wide = useWide();
  const api = useRef<ReaderApi>(null);
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [page, setPage] = useState(progress?.pageNumber ?? 1);
  const [note, setNote] = useState<{
    anchor: SelectionAnchor | null;
    editing: AnnotationItem | null;
  } | null>(null);
  const [tab, setTab] = useState("notes");

  const router = useRouter();
  const liveJobId = document.status === "processing" && document.job?.live ? document.job.id : null;
  const job = useQuery({
    queryKey: jobQueryKey(liveJobId ?? "none"),
    queryFn: () => fetchJob(liveJobId!),
    enabled: Boolean(liveJobId) && !preview,
    refetchInterval: (query) =>
      query.state.data && isTerminalJobStatus(query.state.data.status) ? false : 3000,
  });
  const jobFinished = job.data ? isTerminalJobStatus(job.data.status) : false;
  useEffect(() => {
    // The version's new status (ready or needs attention) comes from the server.
    if (jobFinished) router.refresh();
  }, [jobFinished, router]);

  const aiUnavailableReason =
    document.status === "ready"
      ? "Ready for questions. Cited answers about your documents open soon."
      : document.status === "attention"
        ? (document.job?.errorMessage ?? "This document couldn't be prepared for AI answers.")
        : job.data && !jobFinished
          ? `Processing… ${job.data.phaseLabel} AI becomes available once your document is processed.`
          : "Processing… AI becomes available once your document is processed.";
  const bookmarked = annotations.some(
    (item) => item.kind === "bookmark" && item.pageNumber === page,
  );

  function replace(id: string, next: AnnotationItem | null) {
    setAnnotations((current) =>
      next
        ? current.map((item) => (item.id === id ? next : item))
        : current.filter((item) => item.id !== id),
    );
  }

  /** Shows the annotation at once, then swaps in the saved one or rolls back. */
  async function create(
    draft: Omit<AnnotationItem, "id" | "createdAt">,
    save: () => Promise<
      { ok: true; data: AnnotationItem } | ({ ok: false } & NonNullable<Failure>) | null
    >,
  ) {
    const temporary: AnnotationItem = {
      ...draft,
      id: `pending-${(pendingId += 1)}`,
      createdAt: new Date().toISOString(),
    };
    setAnnotations((current) => [...current, temporary]);
    const result = await save().catch(() => null);
    if (result?.ok) replace(temporary.id, result.data);
    else {
      replace(temporary.id, null);
      reportFailure(result, "We couldn't save that. Please try again.");
    }
  }

  function highlight(anchor: SelectionAnchor, color: HighlightColor) {
    if (preview) return;
    void create({ kind: "highlight", pageNumber: anchor.page, anchor, body: null, color }, () =>
      createAnnotationAction({ kind: "highlight", documentId: document.id, anchor, color }),
    );
  }

  async function toggleBookmark() {
    if (preview) return;
    const existing = annotations.find(
      (item) => item.kind === "bookmark" && item.pageNumber === page,
    );
    if (existing) replace(existing.id, null);
    else {
      setAnnotations((current) => [
        ...current,
        {
          id: `pending-${(pendingId += 1)}`,
          kind: "bookmark",
          pageNumber: page,
          anchor: { page },
          body: null,
          color: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    const result = await toggleBookmarkAction({ documentId: document.id, pageNumber: page }).catch(
      () => null,
    );
    if (!result?.ok) {
      setAnnotations((current) =>
        existing
          ? [...current, existing]
          : current.filter(
              (item) =>
                !(
                  item.id.startsWith("pending-") &&
                  item.kind === "bookmark" &&
                  item.pageNumber === page
                ),
            ),
      );
      reportFailure(result, "We couldn't update the bookmark.");
      return;
    }
    if (result.data.annotation) {
      const saved = result.data.annotation;
      setAnnotations((current) =>
        current.map((item) =>
          item.id.startsWith("pending-") &&
          item.kind === "bookmark" &&
          item.pageNumber === saved.pageNumber
            ? saved
            : item,
        ),
      );
    }
  }

  async function recolor(annotation: AnnotationItem, color: HighlightColor) {
    if (preview || annotation.color === color) return;
    replace(annotation.id, { ...annotation, color });
    const result = await updateAnnotationAction({ annotationId: annotation.id, color }).catch(
      () => null,
    );
    if (result?.ok) replace(annotation.id, result.data);
    else {
      replace(annotation.id, annotation);
      reportFailure(result, "We couldn't change the color.");
    }
  }

  async function remove(annotation: AnnotationItem) {
    if (preview) return;
    replace(annotation.id, null);
    const result = await deleteAnnotationAction(annotation.id).catch(() => null);
    if (!result?.ok) {
      setAnnotations((current) => [...current, annotation]);
      reportFailure(result, "We couldn't delete that. Please try again.");
    }
  }

  const reader = (
    <PdfReader
      documentId={document.id}
      highlights={annotations.filter((item) => item.anchor.rects?.length)}
      initialPosition={progress}
      aiUnavailableReason={aiUnavailableReason}
      onPageChange={(next) => setPage(next)}
      onHighlight={highlight}
      onNote={(anchor) => setNote({ anchor, editing: null })}
      apiRef={api}
      preview={preview}
    />
  );

  const side = (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-3">
      <TabsList className="w-full">
        <TabsTrigger value="notes" className="flex-1">
          Notes
          <span className="text-muted-foreground tabular-nums">{annotations.length}</span>
        </TabsTrigger>
        <TabsTrigger value="ai" className="flex-1">
          Ask AI
        </TabsTrigger>
      </TabsList>
      <TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <AnnotationsPanel
          annotations={annotations}
          onGoTo={(target) => api.current?.goToPage(target)}
          onEdit={(annotation) => setNote({ anchor: null, editing: annotation })}
          onRecolor={(annotation, color) => void recolor(annotation, color)}
          onDelete={(annotation) => void remove(annotation)}
        />
      </TabsContent>
      <TabsContent value="ai" className="min-h-0 flex-1">
        <ChatPanel
          title="Ask about this document"
          description="Answers cite the pages they come from."
          unavailableReason={aiUnavailableReason}
          suggestedPrompts={[
            "Summarize the key ideas of this chapter.",
            "What evidence supports the main argument?",
            "Explain this section in simpler terms.",
          ]}
          className="h-full"
        />
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="space-y-5">
      <PageHeading
        title={document.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={document.status} />
            <span>Private to you.</span>
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setNote({ anchor: api.current?.selection() ?? null, editing: null })}
            >
              <StickyNote aria-hidden="true" />
              Add a note
            </Button>
            <Button
              variant="outline"
              aria-pressed={bookmarked}
              onClick={() => void toggleBookmark()}
            >
              <Bookmark aria-hidden="true" className={bookmarked ? "fill-current" : undefined} />
              {bookmarked ? "Bookmarked" : "Bookmark"}
            </Button>
          </>
        }
      />

      {document.status === "attention" ? (
        <StatusAlert tone="warning" title="This document needs attention.">
          {document.job?.errorMessage ?? "It couldn't be prepared for AI answers."} You can still
          read, highlight and take notes.
          {document.job?.canRetry ? (
            <>
              {" "}
              <Link
                href="/dashboard/library?status=attention"
                className="underline underline-offset-2"
              >
                Retry from My Library
              </Link>
              .
            </>
          ) : null}
        </StatusAlert>
      ) : null}

      {wide ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-[calc(100dvh-15rem)] min-h-[560px] gap-0"
        >
          <ResizablePanel defaultSize="64" minSize="45">
            <div className="h-full pr-2">{reader}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="36" minSize="24">
            <div className="h-full pl-3">{side}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="space-y-5">
          <div className="h-[72dvh] min-h-[440px]">{reader}</div>
          <div className="min-h-[420px]">{side}</div>
        </div>
      )}

      <NoteDialog
        state={note}
        page={page}
        onOpenChange={(open) => {
          if (!open) setNote(null);
        }}
        onSave={async (body) => {
          if (!note || preview) return true;
          if (note.editing) {
            const previous = note.editing;
            replace(previous.id, { ...previous, body });
            const result = await updateAnnotationAction({ annotationId: previous.id, body }).catch(
              () => null,
            );
            if (result?.ok) {
              replace(previous.id, result.data);
              return true;
            }
            replace(previous.id, previous);
            reportFailure(result, "We couldn't save the note.");
            return false;
          }
          const anchor = note.anchor ?? { page };
          api.current?.clearSelection();
          void create(
            {
              kind: "note",
              pageNumber: anchor.page,
              anchor,
              body,
              color: note.anchor ? "yellow" : null,
            },
            () =>
              createAnnotationAction({
                kind: "note",
                documentId: document.id,
                anchor,
                body,
                ...(note.anchor ? { color: "yellow" as const } : {}),
              }),
          );
          setTab("notes");
          return true;
        }}
      />
    </div>
  );
}

function NoteDialog({
  state,
  page,
  onOpenChange,
  onSave,
}: {
  state: { anchor: SelectionAnchor | null; editing: AnnotationItem | null } | null;
  page: number;
  onOpenChange: (open: boolean) => void;
  onSave: (body: string) => Promise<boolean>;
}) {
  return (
    <AppDialog
      open={state !== null}
      onOpenChange={onOpenChange}
      title={state?.editing ? "Edit note" : "Add a note"}
      description={
        state?.editing
          ? `Page ${state.editing.pageNumber}`
          : state?.anchor
            ? `On the selected text, page ${state.anchor.page}`
            : `On page ${page}`
      }
    >
      {state ? (
        <NoteForm
          key={state.editing?.id ?? "new"}
          quote={state.editing?.anchor.text ?? state.anchor?.text ?? null}
          initial={state.editing?.body ?? ""}
          onCancel={() => onOpenChange(false)}
          onSave={async (body) => {
            if (await onSave(body)) onOpenChange(false);
          }}
        />
      ) : null}
    </AppDialog>
  );
}

function NoteForm({
  quote,
  initial,
  onCancel,
  onSave,
}: {
  quote: string | null;
  initial: string;
  onCancel: () => void;
  onSave: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const parsed = noteBodySchema.safeParse(body);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Write something for the note.");
          return;
        }
        setSaving(true);
        await onSave(parsed.data);
        setSaving(false);
      }}
    >
      {quote ? (
        <blockquote className="line-clamp-4 border-l-3 border-highlight-yellow pl-2.5 font-serif text-[0.9375rem]/relaxed">
          {quote}
        </blockquote>
      ) : null}
      <div className="grid gap-1.5">
        <label htmlFor="reader-note" className="text-sm font-medium">
          Note
        </label>
        <Textarea
          id="reader-note"
          value={body}
          rows={5}
          maxLength={5000}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "reader-note-error" : "reader-note-help"}
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id="reader-note-error" className="text-sm text-error">
            {error}
          </p>
        ) : (
          <p id="reader-note-help" className="text-sm text-muted-foreground">
            Up to 5,000 characters. Only you can see your notes.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner aria-hidden="true" /> : null}
          Save note
        </Button>
      </div>
    </form>
  );
}
