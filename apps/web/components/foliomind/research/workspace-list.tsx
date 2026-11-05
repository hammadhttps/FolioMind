"use client";

import { SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import { MoreHorizontal, Network, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { debounce, useQueryStates } from "nuqs";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { workspaceParsers } from "@/lib/search-params";
import { loadMoreWorkspacesAction } from "@/lib/workspaces/actions";
import type { WorkspaceCardView } from "@/lib/workspaces/view";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";
import { useIsPreview } from "../session-user";
import { WorkspaceCard } from "../workspace-card";
import { DeleteWorkspaceDialog, WorkspaceFormDialog } from "./workspace-dialogs";

export interface WorkspaceListData {
  items: WorkspaceCardView[];
  nextCursor: string | null;
}

/**
 * Dashboard research tab (Sections 20 #9 and 24): workspaces with URL-bound
 * search and sort, and Load more. Create, rename and delete dialogs live here.
 */
export function WorkspaceList({ initial }: { initial: WorkspaceListData }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [params, setParams] = useQueryStates(workspaceParsers, { shallow: false });
  const [term, setTerm] = useState(params.q);
  const [renaming, setRenaming] = useState<WorkspaceCardView | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceCardView | null>(null);
  // Pages from Load more belong to the first page they continued; new server data starts over.
  const [more, setMore] = useState<{
    after: string | null;
    items: WorkspaceCardView[];
    nextCursor: string | null;
  }>({ after: null, items: [], nextCursor: null });
  const appended = more.after === initial.nextCursor && more.after !== null ? more : null;
  const [loading, startLoading] = useTransition();

  const items = [...initial.items, ...(appended?.items ?? [])];
  const nextCursor = appended ? appended.nextCursor : initial.nextCursor;
  const filtered = Boolean(params.q);

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function loadMore() {
    if (!nextCursor || preview) return;
    startLoading(async () => {
      const result = await loadMoreWorkspacesAction(
        { ...(params.q ? { q: params.q } : {}), sort: params.sort },
        nextCursor,
      ).catch(() => null);
      if (!result?.ok) {
        if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
        else toast.error("We couldn't load more workspaces. Please try again.");
        return;
      }
      setMore({
        after: initial.nextCursor,
        items: [...(appended?.items ?? []), ...result.data.items],
        nextCursor: result.data.nextCursor,
      });
    });
  }

  const newWorkspace = (label: string, variant: "default" | "outline" = "default") => (
    <WorkspaceFormDialog
      trigger={
        <Button variant={variant}>
          <Network aria-hidden="true" />
          {label}
        </Button>
      }
      onCreated={(workspace) => router.push(`/dashboard/research/${workspace.id}`)}
    />
  );

  return (
    <>
      <PageHeading
        as="h2"
        title={<span className="text-2xl">Make room for a new connection.</span>}
        description="Compare sources in a workspace and keep your findings together."
        actions={newWorkspace("New workspace")}
      />

      {items.length > 0 || filtered ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchField
            value={term}
            onValueChange={onSearch}
            label="Search your workspaces"
            placeholder="Search by name"
            className="sm:max-w-sm"
          />
          <Select
            value={params.sort}
            onValueChange={(sort) =>
              void setParams({ sort: sort === "updated" ? null : (sort as typeof params.sort) })
            }
          >
            <SelectTrigger className="h-10 w-full bg-card sm:ml-auto sm:w-48" aria-label="Sort by">
              {/* Explicit text, so it isn't blank until the page has hydrated. */}
              <SelectValue>{params.sort === "name" ? "Name" : "Recently updated"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Recently updated</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Network}
            title="No workspaces match that search."
            description="Try a broader search or clear your filters."
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setTerm("");
                  void setParams({ q: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Network}
            title="No research workspaces yet."
            description="Create a workspace, add ready documents from your library and ask questions across them."
            actions={newWorkspace("Create a workspace", "outline")}
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Research workspaces">
          {items.map((workspace) => (
            <li key={workspace.id}>
              <WorkspaceCard
                name={workspace.name}
                href={`/dashboard/research/${workspace.id}`}
                sourceCount={workspace.sourceCount}
                label={workspace.description}
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${workspace.name}`}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(workspace)}>
                        <Pencil aria-hidden="true" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(workspace)}
                      >
                        <Trash2 aria-hidden="true" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </li>
          ))}
        </ul>
      )}

      <p className="sr-only" aria-live="polite">
        {items.length === 1 ? "1 workspace" : `${items.length} workspaces`}
      </p>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={loadMore}>
            {loading ? <Spinner aria-hidden="true" /> : null}
            Load more
          </Button>
        </div>
      ) : null}

      <WorkspaceFormDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        workspace={renaming}
        onUpdated={() => router.refresh()}
      />
      <DeleteWorkspaceDialog
        workspace={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </>
  );
}
