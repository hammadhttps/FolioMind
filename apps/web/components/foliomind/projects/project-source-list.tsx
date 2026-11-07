"use client";

import { SOURCE_PICKER_TYPES } from "@foliomind/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Library } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { listProjectSourceCandidatesAction } from "@/lib/projects/actions";
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

export interface SourceCandidateView {
  versionId: string;
  title: string;
  kind: keyof typeof KIND_LABELS;
}

/**
 * Ready, accessible documents with search, a type filter and Load more
 * (Section 24). The caller decides what each row does: a tick in the create
 * dialog, an Add button in the Studio.
 */
export function ProjectSourceList({
  renderAction,
  exclude = [],
  onEmptyLibrary,
}: {
  renderAction: (item: SourceCandidateView) => ReactNode;
  exclude?: readonly string[];
  /** The owner has no ready documents at all. */
  onEmptyLibrary?: () => void;
}) {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<(typeof SOURCE_PICKER_TYPES)[number]>("all");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const candidates = useInfiniteQuery({
    queryKey: ["project-source-candidates", query, type],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const result = await listProjectSourceCandidatesAction({
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
  const excluded = new Set(exclude);
  const all = candidates.data?.pages.flatMap((page) => page.items) ?? [];
  const items = all.filter((item) => !excluded.has(item.versionId));
  const filtered = Boolean(query) || type !== "all";
  const libraryEmpty = candidates.isSuccess && !filtered && all.length === 0;

  useEffect(() => {
    if (libraryEmpty) onEmptyLibrary?.();
  }, [libraryEmpty, onEmptyLibrary]);

  return (
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
      <div className="max-h-56 min-h-24 space-y-1.5 overflow-y-auto">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void candidates.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            variant="plain"
            className="px-0 py-4"
            icon={Library}
            title={filtered ? "No ready documents match." : "No ready documents."}
            description={
              filtered
                ? "Try a broader search."
                : "Documents appear here once they've finished processing in My Library."
            }
            actions={
              filtered ? null : (
                <Button asChild type="button" variant="outline" size="sm">
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
                {renderAction(item)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {candidates.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
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
    </div>
  );
}
