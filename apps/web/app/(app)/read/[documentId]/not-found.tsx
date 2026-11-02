import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/foliomind/empty-state";
import { PageHeading } from "@/components/foliomind/page-heading";
import { Button } from "@/components/ui/button";

/**
 * Missing, deleted and inaccessible documents look the same (Section 11), so
 * the reader never reveals whether someone else's document exists.
 */
export default function DocumentNotFound() {
  return (
    <div className="space-y-6">
      <PageHeading title="This document isn't available." />
      <EmptyState
        icon={FileQuestion}
        title="We couldn't open it."
        description="It may have been deleted, or it isn't shared with your account."
        actions={
          <Button asChild>
            <Link href="/dashboard/library">Go to My Library</Link>
          </Button>
        }
      />
    </div>
  );
}
