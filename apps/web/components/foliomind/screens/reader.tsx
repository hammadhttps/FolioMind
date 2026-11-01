import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  Search,
  StickyNote,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChatPanel } from "../chat-panel";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";
import { Paper } from "../paper";

/**
 * Reader (Section 20 #8): document chrome with toolbar and paper on the left,
 * AI panel on the right; they stack below 981px. PDF.js arrives in Phase 5 and
 * cited answers in Phase 7.
 */
export function ReaderScreen() {
  return (
    <div className="space-y-5">
      <PageHeading
        title="Reader"
        description="Documents from your library open here."
        actions={
          <>
            <ComingSoonButton variant="outline" reason="Notes open with the reader">
              <StickyNote aria-hidden="true" />
              Add a note
            </ComingSoonButton>
            <ComingSoonButton
              variant="outline"
              aria-pressed={false}
              reason="Bookmarks open with the reader"
            >
              <Bookmark aria-hidden="true" />
              Bookmark
            </ComingSoonButton>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <section
          aria-label="Document"
          className="min-w-0 overflow-hidden rounded-xl border bg-reader-chrome"
        >
          <div
            role="toolbar"
            aria-label="Document tools"
            className="flex items-center gap-1 overflow-x-auto border-b bg-card px-2 py-1.5"
          >
            <ToolButton label="Show thumbnails">
              <PanelLeft />
            </ToolButton>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <ToolButton label="Previous page">
              <ChevronLeft />
            </ToolButton>
            <span className="px-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
              Page — of —
            </span>
            <ToolButton label="Next page">
              <ChevronRight />
            </ToolButton>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <ToolButton label="Zoom out">
              <ZoomOut />
            </ToolButton>
            <span className="px-1 text-sm text-muted-foreground tabular-nums">100%</span>
            <ToolButton label="Zoom in">
              <ZoomIn />
            </ToolButton>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <ToolButton label="Find in document">
              <Search />
            </ToolButton>
          </div>
          <div className="p-4 md:p-8">
            <Paper className="flex min-h-[420px] flex-col items-center justify-center text-center md:min-h-[560px]">
              <p className="font-serif text-xl font-semibold">No document is open.</p>
              <p className="mt-2 max-w-sm font-sans text-[0.9375rem] text-paper-ink/70">
                Choose a document in My Library to read it here.
              </p>
              <Button
                asChild
                variant="outline"
                className="mt-6 border-paper-ink/30 bg-transparent font-sans text-paper-ink hover:bg-paper-ink/5"
              >
                <Link href="/dashboard/library">Go to My Library</Link>
              </Button>
            </Paper>
          </div>
        </section>

        <ChatPanel
          title="Ask about this document"
          description="Answers cite the pages they come from."
          unavailableReason="AI becomes available once your document is processed."
          suggestedPrompts={[
            "Summarize the key ideas of this chapter.",
            "What evidence supports the main argument?",
            "Explain this section in simpler terms.",
          ]}
          className="lg:min-h-[640px]"
        />
      </div>
    </div>
  );
}

function ToolButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled
      aria-label={label}
      className="[&_svg]:size-[18px]"
    >
      {children}
    </Button>
  );
}
