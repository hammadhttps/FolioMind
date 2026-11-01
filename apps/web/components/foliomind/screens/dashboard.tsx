"use client";

import { Bookmark, Clock, FilePlus2, FileText, FileUp, Library, Network } from "lucide-react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dashboardTabParser } from "@/lib/search-params";
import { ComingSoonButton } from "../coming-soon";
import { EmptyState } from "../empty-state";
import { Hero, HeroLink } from "../hero";
import { MetricCard } from "../metric-card";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { ProjectsTable } from "../projects-table";
import { WelcomeTitle } from "../session-user";

/**
 * Dashboard (Section 20 #6) with the research workspace list as `?tab=research`.
 * Metrics show "—" and sections are empty until Phases 5–8 supply real data.
 */
export function DashboardScreen() {
  const [tab, setTab] = useQueryState("tab", dashboardTabParser);

  return (
    <div className="space-y-6">
      <PageHeading
        title={<WelcomeTitle />}
        description="Your reading, research and projects, all in one place."
        actions={
          <>
            <ComingSoonButton variant="outline" reason="Uploads open soon">
              <FileUp aria-hidden="true" />
              Upload PDF
            </ComingSoonButton>
            <ComingSoonButton reason="PDF creation opens soon">
              <FilePlus2 aria-hidden="true" />
              Create a PDF
            </ComingSoonButton>
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => void setTab(value === "overview" ? null : (value as typeof tab))}
      >
        <TabsList aria-label="Dashboard sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          <Hero
            as="h2"
            size="dashboard"
            title="Your next great idea is already on your shelf."
            description="Bring your sources together, ask cited questions and shape what you learn into a document."
            actions={
              <>
                <HeroLink href="/dashboard?tab=research">
                  <Network aria-hidden="true" />
                  Start researching
                </HeroLink>
                <HeroLink href="/library" variant="secondary">
                  Explore the library
                </HeroLink>
              </>
            }
          />

          <section aria-label="Your activity" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard label="Saved books" value={null} icon={Bookmark} />
            <MetricCard label="Workspaces" value={null} icon={Network} />
            <MetricCard label="Created projects" value={null} icon={FileText} />
            <MetricCard label="Reading time" value={null} icon={Clock} />
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-6">
              <section aria-labelledby="continue-heading" className="space-y-3">
                <h2 id="continue-heading" className="text-lg font-semibold">
                  Pick up where you left off
                </h2>
                <EmptyState
                  icon={Library}
                  title="Books you open will appear here."
                  description="Open a document from your library and FolioMind will remember your place."
                  actions={
                    <>
                      <Button asChild variant="outline">
                        <Link href="/dashboard/library">Go to My Library</Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link href="/library">Explore the library</Link>
                      </Button>
                    </>
                  }
                />
              </section>

              <section aria-labelledby="projects-heading" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="projects-heading" className="text-lg font-semibold">
                    Your recent projects
                  </h2>
                  <Button asChild variant="link">
                    <Link href="/dashboard/projects">View all</Link>
                  </Button>
                </div>
                <ProjectsTable
                  data={[]}
                  empty={
                    <EmptyState
                      variant="plain"
                      icon={FileText}
                      title="No projects yet."
                      description="Create a PDF from a prompt or from your research sources."
                    />
                  }
                />
              </section>
            </div>

            <aside
              aria-label="Research"
              className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1"
            >
              <Panel title="Research in motion" headingLevel="h2" contentClassName="pt-0">
                <EmptyState
                  variant="plain"
                  className="px-0 py-4"
                  title="No workspaces yet."
                  description="Start a workspace to compare sources side by side."
                  actions={
                    <ComingSoonButton size="sm" variant="outline" reason="Workspaces open soon">
                      New workspace
                    </ComingSoonButton>
                  }
                />
              </Panel>
              <figure className="rounded-xl border bg-card p-5 shadow-card">
                <blockquote className="font-serif text-lg/snug italic">
                  “Good questions lead to good ideas.”
                </blockquote>
                <figcaption className="mt-2 text-sm text-muted-foreground">
                  A thought for today
                </figcaption>
              </figure>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="research" className="mt-4 space-y-6">
          <PageHeading
            as="h2"
            title={<span className="text-2xl">Make room for a new connection.</span>}
            description="Compare up to five sources in a workspace and keep your findings together."
            actions={
              <ComingSoonButton reason="Workspaces open soon">
                <Network aria-hidden="true" />
                New workspace
              </ComingSoonButton>
            }
          />
          <EmptyState
            icon={Network}
            title="No research workspaces yet."
            description="Create a workspace, add ready documents from your library and ask questions across them."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
