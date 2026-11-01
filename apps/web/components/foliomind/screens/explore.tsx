"use client";

import {
  CATALOG_CATEGORIES,
  CATALOG_LANGUAGES,
  SEARCH_MIN_LENGTH,
} from "@foliomind/contracts/search-params";
import { BookOpen, Info, X } from "lucide-react";
import { debounce, useQueryStates } from "nuqs";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { catalogParsers } from "@/lib/search-params";
import { AppDialog } from "../app-dialog";
import { EmptyState } from "../empty-state";
import { FilterPills } from "../filter-tabs";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";

const categoryOptions = CATALOG_CATEGORIES.map((category) => ({
  value: category.slug,
  label: category.name,
}));

/**
 * Explore (Section 20 #2). Filters already live in the URL (Section 24) so
 * views are shareable; approved listings and pagination arrive in Phase 9.
 */
export function ExploreScreen() {
  const [params, setParams] = useQueryStates(catalogParsers, { shallow: false });
  const [term, setTerm] = useState(params.q);

  const hasFilters = Boolean(params.q || params.category.length > 0 || params.language);

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      {
        q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null,
        page: null,
        sort: !trimmed && params.sort === "relevance" ? null : params.sort,
      },
      // Typing replaces the history entry; filters and paging push (Section 24).
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function clearFilters() {
    setTerm("");
    void setParams({ q: null, category: null, language: null, sort: null, page: null });
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="A world of ideas, within reach."
        description="Browse books that independent publishers share, then save the ones you want to read."
        actions={<AboutCollection />}
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SearchField
            value={term}
            onValueChange={onSearch}
            label="Search the library"
            placeholder="Search titles, authors or publishers"
            className="md:max-w-md"
          />
          <div className="grid grid-cols-2 gap-2 md:ml-auto md:flex">
            <Select
              value={params.language ?? "any"}
              onValueChange={(language) =>
                void setParams({ language: language === "any" ? null : language, page: null })
              }
            >
              <SelectTrigger className="h-10 w-full bg-card md:w-44" aria-label="Language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any language</SelectItem>
                {CATALOG_LANGUAGES.map((language) => (
                  <SelectItem key={language.code} value={language.code}>
                    {language.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={params.sort}
              onValueChange={(sort) =>
                void setParams({ sort: sort as typeof params.sort, page: null })
              }
            >
              <SelectTrigger className="h-10 w-full bg-card md:w-40" aria-label="Sort by">
                <SelectValue />
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

        <FilterPills
          label="Categories"
          options={categoryOptions}
          value={params.category}
          onValueChange={(category) =>
            void setParams({ category: category.length ? category : null, page: null })
          }
        />

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            {params.q ? <Badge variant="soft">Search: {params.q}</Badge> : null}
            {params.category.map((slug) => (
              <Badge key={slug} variant="soft">
                {categoryOptions.find((option) => option.value === slug)?.label ?? slug}
              </Badge>
            ))}
            {params.language ? (
              <Badge variant="soft">
                {CATALOG_LANGUAGES.find((language) => language.code === params.language)?.name ??
                  params.language}
              </Badge>
            ) : null}
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {hasFilters ? "No books match these filters." : "No books in the library yet."}
      </p>

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
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null
        }
      />
    </div>
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
