import { Network } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/foliomind/empty-state";
import { PageHeading } from "@/components/foliomind/page-heading";
import { Button } from "@/components/ui/button";

/** Missing and other users' workspaces look the same (Section 11). */
export default function WorkspaceNotFound() {
  return (
    <div className="space-y-6">
      <PageHeading title="This workspace isn't available." />
      <EmptyState
        icon={Network}
        title="We couldn't open it."
        description="It may have been deleted, or it belongs to another account."
        actions={
          <Button asChild>
            <Link href="/dashboard?tab=research">Go to your workspaces</Link>
          </Button>
        }
      />
    </div>
  );
}
