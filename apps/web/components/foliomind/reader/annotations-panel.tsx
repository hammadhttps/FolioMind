"use client";

import { HIGHLIGHT_COLORS, type HighlightColor } from "@foliomind/contracts";
import { Bookmark, Highlighter, Pencil, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnnotationItem } from "@/lib/reader/view";
import { cn } from "@/lib/utils";
import { EmptyState } from "../empty-state";

const KIND_ICONS = { bookmark: Bookmark, highlight: Highlighter, note: StickyNote } as const;
const KIND_LABELS = { bookmark: "Bookmark", highlight: "Highlight", note: "Note" } as const;

/**
 * The reader's bookmarks, highlights and notes in page order. Selecting one
 * jumps to its page; notes can be edited and highlights recolored.
 */
export function AnnotationsPanel({
  annotations,
  onGoTo,
  onEdit,
  onRecolor,
  onDelete,
}: {
  annotations: AnnotationItem[];
  onGoTo: (page: number) => void;
  onEdit: (annotation: AnnotationItem) => void;
  onRecolor: (annotation: AnnotationItem, color: HighlightColor) => void;
  onDelete: (annotation: AnnotationItem) => void;
}) {
  if (annotations.length === 0) {
    return (
      <EmptyState
        variant="plain"
        icon={StickyNote}
        title="No notes yet."
        description="Select text to highlight it or add a note, or bookmark a page from the top of the reader."
      />
    );
  }

  const sorted = [...annotations].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <ul className="space-y-2" aria-label="Bookmarks, highlights and notes">
      {sorted.map((annotation) => {
        const Icon = KIND_ICONS[annotation.kind];
        const pending = annotation.id.startsWith("pending-");
        return (
          <li
            key={annotation.id}
            className={cn("rounded-lg border bg-card p-3", pending && "opacity-60")}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onGoTo(annotation.pageNumber)}
                className="rounded-sm text-sm font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/70"
              >
                {KIND_LABELS[annotation.kind]} · Page {annotation.pageNumber}
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                {annotation.kind !== "bookmark" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    aria-label={annotation.body ? "Edit note" : "Add a note to this highlight"}
                    onClick={() => onEdit(annotation)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={`Delete ${KIND_LABELS[annotation.kind].toLowerCase()} on page ${annotation.pageNumber}`}
                  onClick={() => onDelete(annotation)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            {annotation.anchor.text ? (
              <blockquote
                className="mt-2 line-clamp-4 border-l-3 pl-2.5 font-serif text-[0.9375rem]/relaxed"
                style={{ borderColor: `var(--highlight-${annotation.color ?? "yellow"})` }}
              >
                {annotation.anchor.text}
              </blockquote>
            ) : null}
            {annotation.body ? (
              <p className="mt-2 text-sm whitespace-pre-wrap">{annotation.body}</p>
            ) : null}
            {annotation.kind === "highlight" ? (
              <div
                className="mt-2 flex items-center gap-1"
                role="group"
                aria-label="Highlight color"
              >
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    disabled={pending}
                    aria-pressed={annotation.color === color}
                    aria-label={`${color[0]!.toUpperCase()}${color.slice(1)}`}
                    onClick={() => onRecolor(annotation, color)}
                    className="flex size-7 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70 aria-pressed:bg-muted"
                  >
                    <span
                      className="size-4 rounded-full border border-foreground/15"
                      style={{ background: `var(--highlight-${color})` }}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
