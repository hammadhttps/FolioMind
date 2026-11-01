import { FilePlus2, Library, Pencil } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChatPanel } from "../chat-panel";
import { ComingSoonButton } from "../coming-soon";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";

/**
 * Research Workspace detail (Section 20 #9): source rail (five-source cap),
 * auto-saved notes and a broad chat. Cross-document answers arrive in Phase 7.
 */
export function ResearchWorkspaceScreen() {
  return (
    <div className="space-y-5">
      <PageHeading
        title="Research workspace"
        description="Compare up to five sources and keep your findings together."
        actions={
          <>
            <ComingSoonButton variant="outline" reason="Workspaces open soon">
              <Pencil aria-hidden="true" />
              Rename
            </ComingSoonButton>
            <ComingSoonButton reason="PDF creation opens soon">
              <FilePlus2 aria-hidden="true" />
              Turn into a PDF
            </ComingSoonButton>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Sources"
            description="Select up to five ready documents."
            contentClassName="pt-0"
          >
            <EmptyState
              variant="plain"
              className="px-0 py-4"
              icon={Library}
              title="No sources yet."
              description="Add ready documents from your library to compare them here."
              actions={
                <ComingSoonButton size="sm" variant="outline" reason="Workspaces open soon">
                  Add sources
                </ComingSoonButton>
              }
            />
          </Panel>
          <Panel
            title="Notes"
            description="Saved automatically as you write."
            contentClassName="pt-0"
          >
            <Label htmlFor="workspace-notes" className="sr-only">
              Workspace notes
            </Label>
            <Textarea
              id="workspace-notes"
              disabled
              rows={6}
              placeholder="Notes open once your workspace has sources."
              className="resize-none"
            />
          </Panel>
        </div>

        <ChatPanel
          title="Ask across your sources"
          description="Answers cite each source and page."
          unavailableReason="Add ready sources to ask questions across them."
          suggestedPrompts={[
            "What are the key ideas across these sources?",
            "Where do these sources agree or disagree?",
            "How could I apply these ideas in practice?",
          ]}
          className="lg:min-h-[600px]"
        />
      </div>
    </div>
  );
}
