"use client";

import { Plus, StickyNote, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { createNoteAction, deleteNoteAction } from "@/lib/workspaces/actions";
import type { NoteView } from "@/lib/workspaces/view";
import { SourceChip } from "../chat-panel";
import { useOpenCitation } from "../chat/use-open-citation";
import { EmptyState } from "../empty-state";
import { useIsPreview } from "../session-user";

/** The editor is large, and only this panel needs it. */
const NoteEditor = dynamic(() => import("./note-editor"), {
  ssr: false,
  loading: () => <Skeleton className="h-20 w-full rounded-md" />,
});

/**
 * Workspace notes (Section 20 #9): saved as you write, and each saved answer
 * keeps source chips that open the Reader. Chips check access again on opening.
 */
export function NotesPanel({
  workspaceId,
  notes,
  onNotesChange,
}: {
  workspaceId: string;
  notes: NoteView[];
  onNotesChange: (update: (current: NoteView[]) => NoteView[]) => void;
}) {
  const preview = useIsPreview();
  const openCitation = useOpenCitation();
  const [adding, setAdding] = useState(false);

  async function addNote() {
    setAdding(true);
    const result = await createNoteAction(workspaceId).catch(() => null);
    setAdding(false);
    if (result?.ok) {
      onNotesChange((current) => [result.data, ...current]);
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error(result?.formError ?? "We couldn't add a note. Please try again.");
  }

  async function removeNote(note: NoteView) {
    onNotesChange((current) => current.filter((item) => item.id !== note.id));
    const result = await deleteNoteAction(note.id).catch(() => null);
    if (!result?.ok) {
      onNotesChange((current) => [note, ...current]);
      if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
      else toast.error(result?.formError ?? "We couldn't delete that note. Please try again.");
    }
  }

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        disabled={adding || preview}
        onClick={() => void addNote()}
      >
        <Plus aria-hidden="true" />
        New note
      </Button>
      {notes.length === 0 ? (
        <EmptyState
          variant="plain"
          className="px-0 py-4"
          icon={StickyNote}
          title="No notes yet."
          description="Write your own, or use Save to notes on an answer you want to keep."
        />
      ) : (
        <ul className="space-y-3" aria-label="Your notes">
          {notes.map((note, index) => (
            <li key={note.id} className="rounded-lg border bg-background p-2">
              <NoteEditor
                noteId={note.id}
                initial={note.body}
                label={`Note ${notes.length - index}`}
                preview={preview}
              />
              <div className="mt-1.5 flex items-end justify-between gap-2">
                {note.citations.length > 0 ? (
                  <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Sources for this note">
                    {note.citations.map((citation) => (
                      <li key={citation.label} className="max-w-full min-w-0">
                        <SourceChip
                          label={citation.label}
                          title={citation.title}
                          page={citation.pageStart}
                          onOpen={() => void openCitation(citation)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span />
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={preview}
                  aria-label={`Delete note ${notes.length - index}`}
                  onClick={() => void removeNote(note)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
