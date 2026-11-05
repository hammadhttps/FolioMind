"use client";

import { SOURCE_PICKER_TYPES } from "@foliomind/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Library, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { addWorkspaceSourceAction, listSourceCandidatesAction } from "@/lib/workspaces/actions";
import { AppDialog } from "../app-dialog";
import { EmptyState } from "../empty-state";
import { FilterTabs } from "../filter-tabs";
import { SearchField } from "../search-field";
import { StatusAlert } from "../status-alert";

const TYPE_OPTIONS: { value: (typeof SOURCE_PICKER_TYPES)[number]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "uploads", label: "Uploads" },
  { value: "imported", label: "Imported" },
  { value: "saved", label: "Saved" },
];
const KIND_LABELS = { upload: "Upload", imported: "Imported", saved: "Saved book" } as const;

/**
 * Source picker (Section 24): ready, accessible documents only, recently opened
 * first, with search, type filter and Load more. The cap is checked on the
 * server when a source is added.
 */
export function SourcePickerDialog({
  workspaceId,
  open,
  onOpenChange,
  remaining,
  limit,
  onAdded,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remaining: number;
  limit: number;
  onAdded: () => void;
}) {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<(typeof SOURCE_PICKER_TYPES)[number]>("all");
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const candidates = useInfiniteQuery({
    queryKey: ["source-candidates", workspaceId, query, type],
    enabled: open,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const result = await listSourceCandidatesAction({
        workspaceId,
        q: query || undefined,
        type,
        cursor: pageParam,
      });
      if (!result.ok) throw new Error(result.formError ?? "We couldn't load your documents.");
      return result.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  });
  const items = (candidates.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => !added.has(item.versionId),
  );
  // `remaining` follows the server after each addition, and the server enforces the cap anyway.
  const atCap = remaining <= 0;

  async function add(versionId: string) {
    setAdding(versionId);
    setError(null);
    const result = await addWorkspaceSourceAction({ workspaceId, versionId }).catch(() => null);
    setAdding(null);
    if (result?.ok) {
      setAdded((current) => new Set(current).add(versionId));
      onAdded();
      toast.success("Source added.");
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else setError(result?.formError ?? "We couldn't add that source. Please try again.");
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setAdded(new Set());
          setError(null);
        }
      }}
      title="Add sources"
      description={`Only documents that have finished processing can be added. Your plan allows ${limit} in a workspace.`}
    >
      <div className="space-y-3">
        <SearchField
          value={term}
          onValueChange={setTerm}
          label="Search your documents"
          placeholder="Search by title"
        />
        <FilterTabs
          label="Document type"
          options={TYPE_OPTIONS}
          value={type}
          onValueChange={(value) => setType(value as typeof type)}
        />
        {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}
        {atCap ? (
          <StatusAlert tone="info" title={`This workspace has its ${limit} sources.`}>
            Remove one to add another, or{" "}
            <Link href="/pricing" className="underline underline-offset-2">
              compare plans
            </Link>{" "}
            for a higher limit.
          </StatusAlert>
        ) : null}
        <div className="max-h-72 min-h-32 space-y-1.5 overflow-y-auto">
          {candidates.isPending ? (
            <>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </>
          ) : candidates.isError ? (
            <StatusAlert
              tone="error"
              title="We couldn't load your documents."
              action={
                <Button variant="outline" size="sm" onClick={() => void candidates.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              variant="plain"
              className="px-0 py-6"
              icon={Library}
              title={
                query || type !== "all" ? "No ready documents match." : "No more ready documents."
              }
              description={
                query || type !== "all"
                  ? "Try a broader search."
                  : "Documents appear here once they've finished processing in My Library."
              }
              actions={
                query || type !== "all" ? null : (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard/library">Go to My Library</Link>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="space-y-1.5" aria-label="Ready documents">
              {items.map((item) => (
                <li
                  key={item.versionId}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
                >
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{KIND_LABELS[item.kind]}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={atCap || adding !== null}
                    aria-label={`Add ${item.title}`}
                    onClick={() => void add(item.versionId)}
                  >
                    {adding === item.versionId ? (
                      <Spinner aria-hidden="true" />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {candidates.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={candidates.isFetchingNextPage}
              onClick={() => void candidates.fetchNextPage()}
            >
              {candidates.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
