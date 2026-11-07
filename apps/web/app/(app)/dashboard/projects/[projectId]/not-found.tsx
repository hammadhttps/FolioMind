import { FileText } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/foliomind/empty-state";
import { PageHeading } from "@/components/foliomind/page-heading";
import { Button } from "@/components/ui/button";

/** Missing and other users' projects look the same (Section 11). */
export default function ProjectNotFound() {
  return (
    <div className="space-y-6">
      <PageHeading title="This project isn't available." />
      <EmptyState
        icon={FileText}
        title="We couldn't open it."
        description="It may have been deleted, or it belongs to another account."
        actions={
          <Button asChild>
            <Link href="/dashboard/projects">Go to your projects</Link>
          </Button>
        }
      />
    </div>
  );
}
