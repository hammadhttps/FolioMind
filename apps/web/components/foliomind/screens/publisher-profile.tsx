"use client";

import type { CatalogBookCard } from "@foliomind/contracts";
import {
  SEARCH_MIN_LENGTH,
  type PublisherBooksSearchParams,
} from "@foliomind/contracts/search-params";
import { BookOpen, Building2, X } from "lucide-react";
import Image from "next/image";
import { debounce, useQueryStates } from "nuqs";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { publisherHref, totalPages } from "@/lib/catalog/urls";
import { publisherBooksParsers } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { BookCard } from "../book-card";
import { CatalogPagination } from "../catalog/catalog-pagination";
import { SaveBookButton } from "../catalog/save-book-button";
import { EmptyState } from "../empty-state";
import { FilterPills } from "../filter-tabs";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";

export interface PublisherProfileView {
  id: string;
  slug: string;
  name: string;
  bio: string;
  website: string | null;
  avatarUrl: string | null;
  bookCount: number;
  followers: number;
}

const DEFAULT_PARAMS: PublisherBooksSearchParams = {
  q: undefined,
  category: [],
  sort: "newest",
  page: 1,
};

/**
 * Publisher Profile (Sections 5 row 4 and 20 #4): the public biography,
 * picture, website and approved books with title search, categories and page
 * numbers. No private analytics or contact data. Following arrives in the
 * `follow` slot, which depends on who is looking.
 */
export function PublisherProfileScreen({
  publisher,
  books,
  total,
  categories = [],
  params = DEFAULT_PARAMS,
  follow,
  viewer = { signedIn: false, savedIds: [] },
}: {
  publisher: PublisherProfileView;
  books: CatalogBookCard[];
  total: number;
  categories?: { slug: string; name: string; count: number }[];
  params?: PublisherBooksSearchParams;
  follow?: ReactNode;
  viewer?: { signedIn: boolean; savedIds: string[] };
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useQueryStates(publisherBooksParsers, { shallow: false, startTransition });
  const [term, setTerm] = useState(url.q);
  const filtered = Boolean(params.q || params.category.length > 0);
  const self = (overrides: Partial<PublisherBooksSearchParams>) =>
    publisherHref(publisher.slug, params, overrides);

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setUrl(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null, page: null },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function clear() {
    setTerm("");
    void setUrl({ q: null, category: null, page: null });
  }

  return (
    <div className="space-y-6">
      <PageHeading title={publisher.name} description="Independent publisher" actions={follow} />

      <Card className="flex-col items-start gap-5 p-6 sm:flex-row">
        {publisher.avatarUrl ? (
          <Image
            src={publisher.avatarUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-2xl object-cover"
          />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary-subtle text-primary-subtle-foreground">
            <Building2 className="size-8" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 space-y-2">
          <p className="text-base/relaxed [overflow-wrap:anywhere] whitespace-pre-line">
            {publisher.bio}
          </p>
          <p className="text-sm text-muted-foreground">
            {publisher.bookCount === 1 ? "1 publication" : `${publisher.bookCount} publications`}
            {" · "}
            {publisher.followers === 1 ? "1 follower" : `${publisher.followers} followers`}
          </p>
          {publisher.website ? (
            <a
              href={publisher.website}
              rel="noopener noreferrer nofollow ugc"
              target="_blank"
              className="text-sm break-all text-link underline-offset-4 hover:underline"
            >
              {publisher.website.replace(/^https?:\/\//, "")}
            </a>
          ) : null}
        </div>
      </Card>

      {publisher.bookCount > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <SearchField
              value={term}
              onValueChange={onSearch}
              label={`Search ${publisher.name}'s books`}
              placeholder="Search by title"
              className="md:max-w-sm"
            />
            <Select
              value={params.sort}
              onValueChange={(sort) =>
                void setUrl({ sort: sort === "newest" ? null : (sort as "title"), page: null })
              }
            >
              <SelectTrigger
                className="h-10 w-full bg-card md:ml-auto md:w-40"
                aria-label="Sort by"
              >
                <SelectValue>{params.sort === "title" ? "Title" : "Newest"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {categories.length > 1 ? (
            <FilterPills
              label="Categories"
              options={categories.map((category) => ({
                value: category.slug,
                label: category.name,
              }))}
              value={params.category}
              onValueChange={(category) =>
                void setUrl({ category: category.length ? category : null, page: null })
              }
            />
          ) : null}
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {total === 0
          ? filtered
            ? "No books match these filters."
            : "No books yet."
          : `${books.length} of ${total} ${total === 1 ? "book" : "books"}`}
      </p>

      {books.length > 0 ? (
        <section
          aria-label="Books"
          aria-busy={pending}
          className={cn("space-y-8", pending && "opacity-60")}
        >
          <ul className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3 2xl:grid-cols-4">
            {books.map((book) => (
              <li key={book.id}>
                <BookCard
                  id={book.id}
                  title={book.title}
                  author={book.author}
                  category={book.categories.map((category) => category.name).join(", ") || null}
                  coverUrl={book.coverUrl}
                  href={`/books/${book.id}`}
                  action={
                    <SaveBookButton
                      variant="icon"
                      bookId={book.id}
                      title={book.title}
                      saved={viewer.savedIds.includes(book.id)}
                      signedIn={viewer.signedIn}
                      returnTo={self({})}
                    />
                  }
                />
              </li>
            ))}
          </ul>
          <CatalogPagination
            page={params.page}
            pages={totalPages(total)}
            hrefFor={(page) => self({ page })}
          />
        </section>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No books here just yet."
          description={
            filtered
              ? "Try a broader search or clear your filters."
              : "This publisher's approved books will appear here."
          }
          actions={
            filtered ? (
              <Button variant="outline" onClick={clear}>
                Clear filters
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}
