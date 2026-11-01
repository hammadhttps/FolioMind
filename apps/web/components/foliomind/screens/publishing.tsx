import { Send } from "lucide-react";
import { ComingSoonButton } from "../coming-soon";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { StatusAlert } from "../status-alert";

/** Publisher Dashboard (Section 20 #12); applications and submissions arrive in Phase 9. */
export function PublishingScreen() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Good ideas deserve good company."
        description="Share books you're authorized to publish with FolioMind readers."
        actions={
          <ComingSoonButton reason="Publisher applications open soon">
            <Send aria-hidden="true" />
            Submit a publication
          </ComingSoonButton>
        }
      />
      <StatusAlert tone="info" title="How publishing works">
        Publishers apply first. After approval, each book you submit is reviewed before it appears
        in the library, and you can revise or unpublish it at any time.
      </StatusAlert>
      <Panel
        title="Your publications"
        description="Submissions, reviews and published listings."
        contentClassName="pt-0"
      >
        <EmptyState
          variant="plain"
          icon={Send}
          title="No publications yet."
          description="When publisher applications open, your submissions and their review status will appear here."
        />
      </Panel>
    </div>
  );
}
