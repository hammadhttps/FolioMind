import { BookX, Send } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BookEditorView, PublisherAccountView } from "@/lib/publishing/view";
import { cn } from "@/lib/utils";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { AddBookDialog } from "../publishing/add-book-dialog";
import { ApplicationPanel } from "../publishing/application-panel";
import { BookEditor } from "../publishing/book-editor";
import { PublisherBooks, type PublisherBooksPage } from "../publishing/publisher-books";
import { PublisherProfileForm } from "../publishing/profile-form";
import { PublisherStats, type PublisherStatsView } from "../publishing/publisher-stats";
import { StatusAlert } from "../status-alert";

export type PublishingState =
  | { kind: "apply"; account: PublisherAccountView; emailVerified: boolean; isAdmin: boolean }
  | { kind: "books"; account: PublisherAccountView; page: PublisherBooksPage }
  | { kind: "stats"; account: PublisherAccountView; stats: PublisherStatsView }
  | { kind: "profile"; account: PublisherAccountView }
  | { kind: "book"; book: BookEditorView; categories: { slug: string; name: string }[] }
  | { kind: "missing-book" };

const EMPTY_STATE: PublishingState = {
  kind: "apply",
  account: { profile: null, slugLocked: false },
  emailVerified: true,
  isAdmin: false,
};

const TABS = [
  { value: "books", label: "Books", href: "/dashboard/publishing" },
  { value: "stats", label: "Stats", href: "/dashboard/publishing?tab=stats" },
  { value: "profile", label: "Profile", href: "/dashboard/publishing?tab=profile" },
] as const;

/**
 * Publisher Dashboard (Sections 5 row 12 and 20 #12): readers see the
 * application and its status; approved publishers manage books, see their
 * aggregate counts and edit their public profile.
 */
export function PublishingScreen({ state = EMPTY_STATE }: { state?: PublishingState }) {
  if (state.kind === "book") return <BookEditor book={state.book} categories={state.categories} />;
  if (state.kind === "missing-book") {
    return (
      <EmptyState
        icon={BookX}
        title="This book isn't available."
        description="It may have been deleted, or it belongs to another publisher."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/publishing">Back to your books</Link>
          </Button>
        }
      />
    );
  }

  const publisher = state.kind !== "apply";
  return (
    <div className="space-y-6">
      <PageHeading
        title="Good ideas deserve good company."
        description="Share books you're authorized to publish with FolioMind readers."
        actions={
          publisher ? (
            <AddBookDialog
              trigger={
                <Button>
                  <Send aria-hidden="true" />
                  Submit a publication
                </Button>
              }
            />
          ) : null
        }
      />

      {state.kind === "apply" ? (
        <>
          <StatusAlert tone="info" title="How publishing works">
            Publishers apply first. After approval, each book you submit is reviewed before it
            appears in the library, and you can revise or unpublish it at any time.
          </StatusAlert>
          <ApplicationPanel
            account={state.account}
            emailVerified={state.emailVerified}
            isAdmin={state.isAdmin}
          />
        </>
      ) : (
        <>
          <nav aria-label="Publishing sections" className="flex gap-1 border-b">
            {TABS.map((tab) => {
              const current = tab.value === state.kind;
              return (
                <Link
                  key={tab.value}
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
                    current
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          {state.kind === "books" ? <PublisherBooks page={state.page} /> : null}
          {state.kind === "stats" ? <PublisherStats stats={state.stats} /> : null}
          {state.kind === "profile" && state.account.profile ? (
            <PublisherProfileForm account={{ ...state.account, profile: state.account.profile }} />
          ) : null}
        </>
      )}
    </div>
  );
}
