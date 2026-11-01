import { Activity, Clock, FileText, Gavel, Inbox, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "../empty-state";
import { MetricCard } from "../metric-card";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";

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

/** Admin Overview (Section 20 #15) layout; server-owned metrics arrive in Phase 9. */
export function AdminOverviewScreen() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Admin overview"
        description="Service health, accounts, applications and audited actions."
      />
      <section aria-label="Overview" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Accounts" value={null} icon={Users} />
        <MetricCard label="Documents" value={null} icon={FileText} />
        <MetricCard label="Pending reviews" value={null} icon={Clock} />
        <MetricCard label="Service status" value={null} icon={Activity} />
      </section>
      <Tabs defaultValue="health">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="health" className="mt-4">
          <Panel title="Processing" description="Background workflows run by the two workers.">
            <ul className="grid gap-3 text-sm md:grid-cols-2">
              <li className="rounded-lg border p-4">
                <p className="font-semibold">Ingestion</p>
                <p className="text-muted-foreground">Extract → chunk → embed → index</p>
              </li>
              <li className="rounded-lg border p-4">
                <p className="font-semibold">Generation and export</p>
                <p className="text-muted-foreground">Draft → review → render</p>
              </li>
            </ul>
          </Panel>
        </TabsContent>
        {(["users", "applications", "usage", "audit"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <EmptyState
              icon={Inbox}
              title="Nothing to show yet."
              description="Records appear here as people use FolioMind."
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** Content Moderation (Section 20 #16) layout; decisions and audit history arrive in Phase 9. */
export function ModerationScreen() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Content moderation"
        description="Review book submissions and reports, with a reason for every decision."
      />
      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="submissions" className="mt-4">
          <EmptyState
            icon={Gavel}
            title="All caught up."
            description="New book submissions will wait here for review."
            actions={
              <Button asChild variant="outline">
                <Link href="/dashboard/publishing">Go to publishing</Link>
              </Button>
            }
          />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <EmptyState
            icon={Inbox}
            title="All caught up."
            description="Reports about catalog content will appear here."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
