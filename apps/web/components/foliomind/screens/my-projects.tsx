import { FilePlus2, FileText } from "lucide-react";
import { ComingSoonButton } from "../coming-soon";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { ProjectsTable, type ProjectRow } from "../projects-table";

/** My Projects (Section 20 #10); projects, filters and exports arrive in Phase 8. */
export function MyProjectsScreen({ projects = [] }: { projects?: ProjectRow[] }) {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Your ideas, taking shape."
        description="Drafts and finished PDFs created from your prompts and research."
        actions={
          <ComingSoonButton reason="PDF creation opens soon">
            <FilePlus2 aria-hidden="true" />
            Create a PDF
          </ComingSoonButton>
        }
      />
      <ProjectsTable
        data={projects}
        empty={
          <EmptyState
            variant="plain"
            icon={FileText}
            title="No projects yet."
            description="Create your first PDF from a prompt or from your research sources."
          />
        }
      />
    </div>
  );
}
