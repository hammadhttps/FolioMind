"use client";

import type { CatalogBookCard, CatalogFacets } from "@foliomind/contracts";
import {
  CATALOG_MAX_PAGE,
  CATALOG_PAGE_SIZE,
  SEARCH_MIN_LENGTH,
  type CatalogSearchParams,
} from "@foliomind/contracts/search-params";
import { BookOpen, Info, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { debounce, useQueryStates } from "nuqs";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { exploreHref, totalPages } from "@/lib/catalog/urls";
import { catalogParsers } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { AppDialog } from "../app-dialog";
import { BookCard } from "../book-card";
import { CatalogPagination } from "../catalog/catalog-pagination";
import { SaveBookButton } from "../catalog/save-book-button";
import { EmptyState } from "../empty-state";
import { FilterPills } from "../filter-tabs";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";

export interface ExploreData {
  total: number;
  books: CatalogBookCard[];
  facets: CatalogFacets;
}

const EMPTY: ExploreData = {
  total: 0,
  books: [],
  facets: { categories: [], languages: [], publishers: [] },
};

const DEFAULT_PARAMS: CatalogSearchParams = {
  q: undefined,
  category: [],
  language: undefined,
  publisher: undefined,
  sort: "newest",
  page: 1,
};

const SORT_LABELS = { newest: "Newest", title: "Title", relevance: "Relevance" } as const;

/**
 * Explore (Sections 5 row 2, 20 #2 and 24): approved listings with search,
 * category, language and publisher filters, sorting and page numbers, all in
 * the URL. While new results load, the current ones stay with a pending hint.
 */
export function ExploreScreen({
  data = EMPTY,
  params = DEFAULT_PARAMS,
  viewer = { signedIn: false, savedIds: [] },
}: {
  data?: ExploreData;
  /** The server's parsed params, which the results match. */
  params?: CatalogSearchParams;
  viewer?: { signedIn: boolean; savedIds: string[] };
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useQueryStates(catalogParsers, { shallow: false, startTransition });
  const [term, setTerm] = useState(url.q);
  const { facets } = data;

  const hasFilters = Boolean(
    params.q || params.category.length > 0 || params.language || params.publisher,
  );
  const pages = totalPages(data.total);
  const deep = Math.ceil(data.total / CATALOG_PAGE_SIZE) > CATALOG_MAX_PAGE;
  const first = (params.page - 1) * CATALOG_PAGE_SIZE + 1;
  const categoryOptions = facets.categories.map((category) => ({
    value: category.slug,
    label: category.name,
  }));

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setUrl(
      {
        q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null,
        page: null,
        // Relevance only makes sense with a query (Section 24).
        sort: trimmed
          ? url.q
            ? url.sort
            : "relevance"
          : url.sort === "relevance"
            ? null
            : url.sort,
      },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function clearFilters() {
    setTerm("");
    void setUrl({
      q: null,
      category: null,
      language: null,
      publisher: null,
      sort: null,
      page: null,
    });
  }

  const announcement =
    data.total === 0
      ? hasFilters
        ? "No books match these filters."
        : "No books in the library yet."
      : `${Math.min(data.total, first + data.books.length - 1) - first + 1} of ${data.total.toLocaleString("en")} ${data.total === 1 ? "book" : "books"}`;

  return (
    <div className="space-y-6">
      <PageHeading
        title="A world of ideas, within reach."
        description="Browse books that independent publishers share, then save the ones you want to read."
        actions={<AboutCollection />}
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex gap-2 md:contents">
            <SearchField
              value={term}
              onValueChange={onSearch}
              label="Search the library"
              placeholder="Search titles, authors or publishers"
              className="min-w-0 flex-1 md:max-w-md"
            />
            <MobileFilters
              params={params}
              facets={facets}
              onApply={(next) =>
                void setUrl({
                  category: next.category.length ? next.category : null,
                  language: next.language ?? null,
                  publisher: next.publisher ?? null,
                  sort: next.sort === "newest" ? null : next.sort,
                  page: null,
                })
              }
            />
          </div>
          <div className="hidden gap-2 md:ml-auto md:flex">
            <FacetSelect
              label="Language"
              anyLabel="Any language"
              value={params.language}
              options={facets.languages.map((language) => ({
                value: language.code,
                label: language.name,
              }))}
              onChange={(language) => void setUrl({ language, page: null })}
            />
            <FacetSelect
              label="Publisher"
              anyLabel="Any publisher"
              value={params.publisher}
              options={facets.publishers.map((publisher) => ({
                value: publisher.slug,
                label: publisher.name,
              }))}
              onChange={(publisher) => void setUrl({ publisher, page: null })}
            />
            <Select
              value={params.sort}
              onValueChange={(sort) =>
                void setUrl({
                  sort: sort === "newest" ? null : (sort as typeof params.sort),
                  page: null,
                })
              }
            >
              <SelectTrigger className="h-10 w-40 bg-card" aria-label="Sort by">
                <SelectValue>{SORT_LABELS[params.sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="relevance" disabled={!params.q}>
                  Relevance
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {categoryOptions.length > 0 ? (
          <FilterPills
            label="Categories"
            options={categoryOptions}
            value={params.category}
            onValueChange={(category) =>
              void setUrl({ category: category.length ? category : null, page: null })
            }
            className="hidden md:flex"
          />
        ) : null}

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            {params.q ? (
              <FilterChip label={`Search: ${params.q}`} onRemove={() => onSearch("")} />
            ) : null}
            {params.category.map((slug) => (
              <FilterChip
                key={slug}
                label={facets.categories.find((category) => category.slug === slug)?.name ?? slug}
                onRemove={() => {
                  const rest = params.category.filter((item) => item !== slug);
                  void setUrl({ category: rest.length ? rest : null, page: null });
                }}
              />
            ))}
            {params.language ? (
              <FilterChip
                label={
                  facets.languages.find((language) => language.code === params.language)?.name ??
                  params.language
                }
                onRemove={() => void setUrl({ language: null, page: null })}
              />
            ) : null}
            {params.publisher ? (
              <FilterChip
                label={
                  facets.publishers.find((publisher) => publisher.slug === params.publisher)
                    ?.name ?? params.publisher
                }
                onRemove={() => void setUrl({ publisher: null, page: null })}
              />
            ) : null}
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      <p
        aria-live="polite"
        className={data.books.length > 0 ? "text-sm text-muted-foreground" : "sr-only"}
      >
        {announcement}
      </p>

      {data.books.length > 0 ? (
        <section
          aria-label="Books"
          aria-busy={pending}
          className={cn("space-y-8 transition-opacity", pending && "opacity-60")}
        >
          <ul className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3 2xl:grid-cols-4">
            {data.books.map((book) => (
              <li key={book.id}>
                <BookCard
                  id={book.id}
                  title={book.title}
                  author={book.author}
                  category={book.categories.map((category) => category.name).join(", ") || null}
                  label={book.publisher.name}
                  coverUrl={book.coverUrl}
                  href={`/books/${book.id}`}
                  action={
                    <SaveBookButton
                      variant="icon"
                      bookId={book.id}
                      title={book.title}
                      saved={viewer.savedIds.includes(book.id)}
                      signedIn={viewer.signedIn}
                      returnTo={exploreHref(params)}
                    />
                  }
                />
              </li>
            ))}
          </ul>
          <CatalogPagination
            page={params.page}
            pages={pages}
            hrefFor={(page) => exploreHref(params, { page })}
          />
          {deep && params.page >= CATALOG_MAX_PAGE ? (
            <p className="text-center text-sm text-muted-foreground">
              That&apos;s as far as the pages go. Refine your search to find more.
            </p>
          ) : null}
        </section>
      ) : data.total > 0 ? (
        <EmptyState
          icon={BookOpen}
          title="There's nothing on this page."
          description="The results end before this page. Go back to the first page."
          actions={
            <Button asChild variant="outline">
              <Link href={exploreHref(params, { page: 1 })}>Go to the first page</Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No books here just yet."
          description={
            hasFilters
              ? "Try a broader search or clear your filters."
              : "Books appear here once publishers share them and each listing is reviewed."
          }
          actions={
            hasFilters ? (
              <>
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/library">Explore the library</Link>
                </Button>
              </>
            ) : null
          }
        />
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="soft" className="gap-1 pr-1">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 outline-none hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/70"
        aria-label={`Remove ${label}`}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </Badge>
  );
}

function FacetSelect({
  label,
  anyLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  anyLabel: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value)?.label ?? anyLabel;
  return (
    <Select value={value ?? "any"} onValueChange={(next) => onChange(next === "any" ? null : next)}>
      <SelectTrigger className={cn("h-10 w-full bg-card md:w-44", className)} aria-label={label}>
        <SelectValue>{current}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Section 24: on phones the filters collapse into a sheet with an Apply button. */
function MobileFilters({
  params,
  facets,
  onApply,
}: {
  params: CatalogSearchParams;
  facets: CatalogFacets;
  onApply: (
    next: Pick<CatalogSearchParams, "category" | "language" | "publisher" | "sort">,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    category: params.category,
    language: params.language,
    publisher: params.publisher,
    sort: params.sort,
  });
  const active = params.category.length + (params.language ? 1 : 0) + (params.publisher ? 1 : 0);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft({
            category: params.category,
            language: params.language,
            publisher: params.publisher,
            sort: params.sort,
          });
        }
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" className="h-10 shrink-0 md:hidden">
          <SlidersHorizontal aria-hidden="true" />
          Filters{active > 0 ? ` (${active})` : ""}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Filter books</SheetTitle>
          <SheetDescription>
            Choose categories, a language, a publisher and the order.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          {facets.categories.length > 0 ? (
            <FilterPills
              label="Categories"
              options={facets.categories.map((category) => ({
                value: category.slug,
                label: category.name,
              }))}
              value={draft.category}
              onValueChange={(category) => setDraft((current) => ({ ...current, category }))}
            />
          ) : null}
          <FacetSelect
            label="Language"
            anyLabel="Any language"
            value={draft.language}
            options={facets.languages.map((language) => ({
              value: language.code,
              label: language.name,
            }))}
            onChange={(language) =>
              setDraft((current) => ({ ...current, language: language ?? undefined }))
            }
          />
          <FacetSelect
            label="Publisher"
            anyLabel="Any publisher"
            value={draft.publisher}
            options={facets.publishers.map((publisher) => ({
              value: publisher.slug,
              label: publisher.name,
            }))}
            onChange={(publisher) =>
              setDraft((current) => ({ ...current, publisher: publisher ?? undefined }))
            }
          />
          <Select
            value={draft.sort}
            onValueChange={(sort) =>
              setDraft((current) => ({ ...current, sort: sort as typeof draft.sort }))
            }
          >
            <SelectTrigger className="h-10 w-full bg-card" aria-label="Sort by">
              <SelectValue>{SORT_LABELS[draft.sort]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="relevance" disabled={!params.q}>
                Relevance
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setDraft({ category: [], language: undefined, publisher: undefined, sort: "newest" })
            }
          >
            Reset
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AboutCollection() {
  return (
    <AppDialog
      trigger={
        <Button variant="outline">
          <Info aria-hidden="true" />
          About the collection
        </Button>
      }
      title="About the collection"
      description="How books reach the FolioMind library."
    >
      <div className="space-y-3 text-[0.9375rem]/relaxed text-muted-foreground">
        <p>
          Independent publishers submit books they are authorized to share. Each submission is
          reviewed before it appears here, and its license statement is shown on the book&apos;s
          page.
        </p>
        <p>
          Saving a book adds it to your personal library; your own uploads always stay private to
          you.
        </p>
      </div>
    </AppDialog>
  );
}
