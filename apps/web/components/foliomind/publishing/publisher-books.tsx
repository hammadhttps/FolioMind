"use client";

import { PUBLISHING_PAGE_SIZE } from "@foliomind/contracts";
import { SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import { BookPlus, ChevronLeft, ChevronRight, Send } from "lucide-react";
import Link from "next/link";
import { debounce, useQueryStates } from "nuqs";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { PublisherBookRowView } from "@/lib/publishing/view";
import { FIRST_KEYSET_PAGE, publishingParsers } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { BookCover } from "../book-cover";
import { EmptyState } from "../empty-state";
import { SearchField } from "../search-field";
import { AddBookDialog } from "./add-book-dialog";
import { ListingStatusChip } from "./listing-status";

const STATUS_LABELS = {
  all: "All statuses",
  draft: "Draft",
  pending: "Pending review",
  published: "Published",
  rejected: "Needs changes",
  unpublished: "Unpublished",
} as const;

export interface PublisherBooksPage {
  items: PublisherBookRowView[];
  nextCursor: string | null;
  prevCursor: string | null;
}

/** Publisher Dashboard list (Section 24): title, status, recently updated, keyset pages of 20. */
export function PublisherBooks({ page }: { page: PublisherBooksPage }) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(publishingParsers, {
    shallow: false,
    startTransition,
  });
  const [term, setTerm] = useState(params.q);
  const filtered = Boolean(params.q) || params.status !== "all";
  const first = params.start;
  const last = first + page.items.length - 1;

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null, ...FIRST_KEYSET_PAGE },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  const add = (
    <AddBookDialog
      trigger={
        <Button>
          <BookPlus aria-hidden="true" />
          Add your first book
        </Button>
      }
    />
  );

  return (
    <div className="space-y-4">
      {page.items.length > 0 || filtered ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchField
            value={term}
            onValueChange={onSearch}
            label="Search your books"
            placeholder="Search by title"
            className="sm:max-w-xs"
          />
          <Select
            value={params.status}
            onValueChange={(status) =>
              void setParams({
                status: status === "all" ? null : (status as typeof params.status),
                ...FIRST_KEYSET_PAGE,
              })
            }
          >
            <SelectTrigger className="h-10 w-full bg-card sm:w-48" aria-label="Status">
              <SelectValue>{STATUS_LABELS[params.status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {page.items.length === 0 ? (
        filtered ? (
          <EmptyState
            variant="plain"
            icon={Send}
            title="No books match these filters."
            description="Try a broader search or clear your filters."
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setTerm("");
                  void setParams({ q: null, status: null, ...FIRST_KEYSET_PAGE });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            variant="plain"
            icon={Send}
            title="No publications yet."
            description="Add a book you're authorized to share. It's reviewed before it appears in the library."
            actions={add}
          />
        )
      ) : (
        <ul
          aria-busy={pending}
          className={cn("divide-y rounded-xl border bg-card", pending && "opacity-60")}
        >
          {page.items.map((book) => (
            <li key={book.id} className="flex items-center gap-4 p-4">
              <div className="w-12 shrink-0">
                <BookCover id={book.id} title={book.title} imageUrl={book.coverUrl} sizes="48px" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <Link
                  href={`/dashboard/publishing?book=${book.id}`}
                  className="block truncate font-semibold underline-offset-4 hover:underline"
                >
                  {book.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <ListingStatusChip status={book.listingStatus} />
                  {book.live && book.listingStatus !== "published" ? <span>Live</span> : null}
                  <span>Updated {formatDate(book.updatedAt)}</span>
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link
                  href={`/dashboard/publishing?book=${book.id}`}
                  aria-label={`Open ${book.title}`}
                >
                  Open
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {page.items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {first}–{last}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!page.prevCursor}
              onClick={() =>
                void setParams({
                  before: page.prevCursor,
                  after: null,
                  start: Math.max(1, first - PUBLISHING_PAGE_SIZE),
                })
              }
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!page.nextCursor}
              onClick={() =>
                void setParams({
                  after: page.nextCursor,
                  before: null,
                  start: first + page.items.length,
                })
              }
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
