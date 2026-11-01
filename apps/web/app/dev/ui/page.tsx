import { Bookmark, FileText, Info, Library, Network, Plus, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppDialog } from "@/components/foliomind/app-dialog";
import { BookCard } from "@/components/foliomind/book-card";
import { BookCover, COVER_VARIANTS } from "@/components/foliomind/book-cover";
import { ChatPanel, SourceChip } from "@/components/foliomind/chat-panel";
import { ComingSoonButton } from "@/components/foliomind/coming-soon";
import { EmptyState } from "@/components/foliomind/empty-state";
import { ErrorState } from "@/components/foliomind/error-state";
import { FooterNote } from "@/components/foliomind/footer-note";
import { Hero, HeroLink } from "@/components/foliomind/hero";
import { MetricCard } from "@/components/foliomind/metric-card";
import { PageHeading } from "@/components/foliomind/page-heading";
import { Panel } from "@/components/foliomind/panel";
import { Paper } from "@/components/foliomind/paper";
import { ProgressBar } from "@/components/foliomind/progress-bar";
import { ProjectsTable } from "@/components/foliomind/projects-table";
import { SignInDialog } from "@/components/foliomind/sign-in-dialog";
import { CoverGridSkeleton, PanelSkeleton, TableSkeleton } from "@/components/foliomind/skeletons";
import { STATUS_STYLES, StatusChip, type StatusKind } from "@/components/foliomind/status-chip";
import { StatusAlert } from "@/components/foliomind/status-alert";
import { UploadDialog } from "@/components/foliomind/upload-dialog";
import { WorkspaceCard } from "@/components/foliomind/workspace-card";
import { Logo } from "@/components/icons/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DevBanner } from "./dev-banner";
import { GalleryThemeToggle, InteractiveDemos } from "./interactive";
import { SAMPLE_BOOKS, SAMPLE_PROJECTS } from "./sample-data";
import { SCREEN_PREVIEWS } from "./screens/registry";

export const metadata: Metadata = { title: "Component gallery", robots: { index: false } };

const SWATCHES = [
  "background",
  "foreground",
  "card",
  "muted",
  "muted-foreground",
  "primary",
  "primary-subtle",
  "research",
  "research-subtle",
  "highlight",
  "border",
  "input",
  "ring",
  "success-bg",
  "warning-bg",
  "info-bg",
  "error-bg",
  "reader-chrome",
  "paper",
  "paper-ink",
];

/** Development-only gallery (Phase 3 step 7): every product component in each state. */
export default function ComponentGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-svh bg-background">
      <DevBanner>
        <GalleryThemeToggle />
      </DevBanner>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1400px] space-y-14 px-[18px] py-10 outline-none md:px-9"
      >
        <PageHeading
          eyebrow="FolioMind design system"
          title="Component gallery"
          description="Every product component, in empty, loading, populated (sample) and error states. Toggle the theme to review both."
        />

        <Section
          title="Screen previews"
          description="Signed-in screens inside the workspace shell with a sample user."
        >
          <ul className="flex flex-wrap gap-2">
            {Object.entries(SCREEN_PREVIEWS).map(([slug, preview]) => (
              <li key={slug}>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dev/ui/screens/${slug}`}>{preview.title}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Brand and color tokens">
          <div className="flex flex-wrap items-center gap-8">
            <Logo size="header" href="/dev/ui" />
            <Logo size="sidebar" href="/dev/ui" />
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {SWATCHES.map((token) => (
              <li key={token} className="overflow-hidden rounded-lg border bg-card text-xs">
                <span
                  className="block h-12 border-b"
                  style={{ backgroundColor: `var(--${token})` }}
                />
                <span className="block px-2 py-1.5 font-mono">--{token}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Typography">
          <div className="space-y-3">
            <p className="font-serif text-4xl font-semibold">Source Serif 4 — editorial headline</p>
            <p className="text-[1.875rem] font-semibold">Inter 30px — page heading</p>
            <p className="text-lg font-semibold">Inter 18px — section heading</p>
            <p className="text-base">
              Inter 16px — body text with a comfortable 1.5 line height for longer reading.
            </p>
            <p className="text-sm text-muted-foreground">
              Inter 14px — supporting text on the muted foreground token.
            </p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="research">Approve &amp; create draft</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary (neutral)</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Text link</Button>
            <Button variant="destructive">
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button>Default 38px</Button>
            <Button size="lg">Large 44px</Button>
            <Button size="icon" aria-label="Add">
              <Plus aria-hidden="true" />
            </Button>
            <Button disabled>Disabled</Button>
            <ComingSoonButton>Coming soon (focusable)</ComingSoonButton>
          </div>
        </Section>

        <Section title="Badges and status chips">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STATUS_STYLES) as StatusKind[]).map((status) => (
              <StatusChip key={status} status={status} />
            ))}
            <Badge variant="highlight">Highlight</Badge>
            <Badge variant="research">Research</Badge>
            <SourceChip label="Sample source" page={12} />
          </div>
        </Section>

        <Section title="Alerts">
          <div className="grid gap-3 md:grid-cols-2">
            <StatusAlert tone="info" title="Information">
              Helpful context with an icon and text.
            </StatusAlert>
            <StatusAlert tone="success" title="Your PDF is ready to read.">
              Success state.
            </StatusAlert>
            <StatusAlert tone="warning" title="Needs attention">
              Warning state with a recovery action.
            </StatusAlert>
            <StatusAlert tone="error" title="We couldn't add that file.">
              Error state announced to screen readers.
            </StatusAlert>
          </div>
        </Section>

        <Section title="Empty, loading and error states">
          <div className="grid gap-5 lg:grid-cols-2">
            <EmptyState
              icon={Library}
              title="No books here just yet."
              description="Try a broader search or clear your filters."
              actions={<Button variant="outline">Clear filters</Button>}
            />
            <PanelSkeleton />
            <TableSkeleton rows={2} />
            <div className="rounded-xl border bg-card">
              <ErrorState />
            </div>
          </div>
          <CoverGridSkeleton count={3} className="mt-5 lg:grid-cols-6" />
        </Section>

        <Section title="Hero">
          <div className="space-y-5">
            <Hero
              eyebrow="A home for curious minds"
              title={
                <>
                  Read deeply.
                  <br />
                  Connect freely.
                  <br />
                  Create thoughtfully.
                </>
              }
              description="Home hero (fixed lavender in both themes)."
              actions={
                <>
                  <HeroLink href="/dev/ui">Primary</HeroLink>
                  <HeroLink href="/dev/ui" variant="secondary">
                    Secondary
                  </HeroLink>
                </>
              }
            />
            <Hero
              as="h2"
              size="dashboard"
              title="Your next great idea is already on your shelf."
              description="Dashboard hero."
              actions={<HeroLink href="/dev/ui">Start researching</HeroLink>}
            />
          </div>
        </Section>

        <Section title="Cards (sample data)">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard label="Saved books" value={null} icon={Bookmark} hint="Empty: shows —" />
            <MetricCard label="Workspaces (sample)" value={3} icon={Network} />
            <MetricCard label="Projects (sample)" value={7} icon={FileText} />
            <MetricCard label="Reading time" value={null} icon={Info} />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-6 sm:grid-cols-6">
            {Object.keys(COVER_VARIANTS).map((variant, index) => (
              <BookCover
                key={variant}
                id={SAMPLE_BOOKS[index]?.id ?? variant}
                title={`${variant} cover`}
                author="Sample Author"
                label="Sample"
              />
            ))}
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-4">
            {SAMPLE_BOOKS.slice(0, 4).map((book, index) => (
              <li key={book.id}>
                <BookCard
                  {...book}
                  progress={index === 0 ? 42 : undefined}
                  badge={index === 1 ? <StatusChip status="processing" /> : undefined}
                />
              </li>
            ))}
          </ul>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <WorkspaceCard
              name="Sample workspace"
              href="/dev/ui/screens/research-workspace"
              sourceCount={3}
              label="Sample collection"
              updatedLabel="Sample date"
            />
            <Panel title="Panel title" description="Panel description">
              <p className="text-sm text-muted-foreground">Panel content.</p>
            </Panel>
            <Panel title="Progress">
              <div className="space-y-3">
                <ProgressBar value={null} label="Unknown yet" />
                <ProgressBar value={40} label="Sample usage" valueLabel="2 of 5" />
              </div>
            </Panel>
          </div>
        </Section>

        <Section title="Projects table">
          <div className="space-y-5">
            <ProjectsTable data={SAMPLE_PROJECTS} empty={null} />
            <ProjectsTable
              data={[]}
              empty={
                <EmptyState
                  variant="plain"
                  icon={FileText}
                  title="No projects yet."
                  description="Empty state."
                />
              }
            />
          </div>
        </Section>

        <Section title="Filters and search">
          <InteractiveDemos />
        </Section>

        <Section title="Reader, chat and paper">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Paper runningHead="Sample running head" pageNumber={12}>
              <p className="mb-2 font-sans text-xs tracking-[0.14em] uppercase opacity-60">
                Chapter 2
              </p>
              <h3 className="mb-4 text-2xl font-semibold">Sample chapter title</h3>
              <p>
                Sample paragraph on warm paper. The paper keeps its color and dark ink in both
                themes.
              </p>
              <blockquote className="my-6 border-l-4 border-[#0F766E] pl-4 italic">
                A sample quotation with the teal rule.
              </blockquote>
              <p>Another sample paragraph to show the reading rhythm.</p>
            </Paper>
            <div className="space-y-5">
              <ChatPanel
                title="Ask about this document"
                messages={
                  <div className="space-y-3">
                    <p className="ml-auto max-w-[85%] rounded-xl bg-primary-subtle px-3.5 py-2.5 text-sm text-primary-subtle-foreground">
                      Sample question?
                    </p>
                    <div className="max-w-[90%] space-y-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm">
                      <p>Sample answer text with a citation.</p>
                      <SourceChip label="Sample source" page={12} />
                    </div>
                  </div>
                }
              />
              <ChatPanel
                unavailableReason="AI becomes available once your document is processed."
                suggestedPrompts={["Sample suggested question"]}
              />
            </div>
          </div>
        </Section>

        <Section title="Dialogs">
          <div className="flex flex-wrap gap-3">
            <AppDialog
              trigger={<Button variant="outline">Open dialog</Button>}
              title="Dialog title"
              description="Dialogs are 520px at most."
              footer={<Button>Confirm</Button>}
            >
              <p className="text-sm text-muted-foreground">Dialog content.</p>
            </AppDialog>
            <UploadDialog trigger={<Button variant="outline">Upload dialog</Button>} />
            <SignInDialog returnTo="/dev/ui">
              <Button variant="outline">Sign-in dialog</Button>
            </SignInDialog>
          </div>
          <FooterNote
            className="mt-6"
            action={
              <Button variant="link" size="sm">
                Learn more
              </Button>
            }
          >
            Footer note: a modest reassurance line.
          </FooterNote>
        </Section>
      </main>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1 border-b pb-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
