import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";

/** Shown to signed-in users without the admin role; the check runs on the server. */
export function AdminAccessRequired() {
  return (
    <div className="space-y-6">
      <PageHeading title="Admin" />
      <EmptyState
        icon={ShieldCheck}
        title="Admin access required."
        description="This area is only available to FolioMind administrators."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}

export { AdminOverviewScreen } from "../admin/admin-overview";
export { ModerationScreen } from "../admin/moderation-screen";
