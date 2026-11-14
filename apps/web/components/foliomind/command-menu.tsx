"use client";

import { globalSearchResponseSchema, type GlobalSearchResponse } from "@foliomind/contracts";
import { SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import { BookOpen, Building2, FileText, Library, Loader2, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  adminNav,
  billingNav,
  discoverNav,
  settingsNav,
  workspaceNav,
  type NavItem,
} from "@/lib/navigation";
import { handleRateLimitResponse } from "@/lib/rate-limit-toast";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; results: GlobalSearchResponse };

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Global search (⌘K / Ctrl+K, Section 20 shared interactions): pages the user
 * can open, plus permission-filtered content from `/api/search`: the public
 * catalog, and the user's own library and projects. Requests are debounced and
 * a newer one cancels the one before it.
 */
export function CommandMenu({
  open,
  onOpenChange,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const term = query.trim();
  const searching = term.length >= SEARCH_MIN_LENGTH;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !searching) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearch({ status: "loading" });
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (handleRateLimitResponse(response) || !response.ok) {
          setSearch({ status: "error" });
          return;
        }
        const parsed = globalSearchResponseSchema.safeParse(await response.json());
        setSearch(parsed.success ? { status: "done", results: parsed.data } : { status: "error" });
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setSearch({ status: "error" });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, searching, term, attempt]);

  const groups: { heading: string; items: NavItem[] }[] = [
    { heading: "Workspace", items: workspaceNav },
    { heading: "Discover", items: discoverNav },
    { heading: "Account", items: [settingsNav, billingNav] },
    ...(isAdmin ? [{ heading: "Admin", items: adminNav }] : []),
  ];
  const lower = term.toLowerCase();
  const pageGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !lower || item.title.toLowerCase().includes(lower)),
    }))
    .filter((group) => group.items.length > 0);
  const showPricing = !lower || "pricing plans".includes(lower);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  const results = search.status === "done" && searching ? search.results : null;
  const contentCount = results
    ? results.books.length +
      results.publishers.length +
      results.library.length +
      results.projects.length
    : 0;
  const nothing = pageGroups.length === 0 && !showPricing && contentCount === 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title="Search FolioMind"
      description="Search books, your library and projects, or go to a page"
      className="sm:max-w-[520px]"
    >
      {/* This CommandDialog does not include cmdk's root, so it is added here. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search books, your library or projects…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {searching && search.status === "loading" ? (
            <div
              role="status"
              className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              Searching…
            </div>
          ) : null}
          {searching && search.status === "error" ? (
            <div role="alert" className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>Search isn&apos;t available right now.</span>
              <button
                type="button"
                className="font-medium text-link underline-offset-4 hover:underline"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : null}
          {nothing && search.status !== "loading" ? (
            <CommandEmpty>
              {searching ? `Nothing matches “${term}”.` : "No pages match that search."}
            </CommandEmpty>
          ) : null}

          {results && results.books.length + results.publishers.length > 0 ? (
            <CommandGroup heading="Books and authors">
              {results.books.map((book) => (
                <CommandItem key={book.id} value={`book-${book.id}`} onSelect={() => go(book.href)}>
                  <BookOpen aria-hidden="true" />
                  <span className="truncate">{book.title}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {book.author}
                  </span>
                </CommandItem>
              ))}
              {results.publishers.map((publisher) => (
                <CommandItem
                  key={publisher.slug}
                  value={`publisher-${publisher.slug}`}
                  onSelect={() => go(publisher.href)}
                >
                  <Building2 aria-hidden="true" />
                  <span className="truncate">{publisher.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Publisher</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results && results.library.length > 0 ? (
            <CommandGroup heading="My Library">
              {results.library.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`library-${item.id}`}
                  onSelect={() => go(item.href)}
                >
                  <Library aria-hidden="true" />
                  <span className="truncate">{item.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.kind === "saved"
                      ? "Saved"
                      : item.kind === "imported"
                        ? "Imported"
                        : "Upload"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results && results.projects.length > 0 ? (
            <CommandGroup heading="Projects">
              {results.projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project-${project.id}`}
                  onSelect={() => go(project.href)}
                >
                  <FileText aria-hidden="true" />
                  <span className="truncate">{project.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {pageGroups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`${group.heading} ${item.title}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon aria-hidden="true" />
                    {item.title}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          {showPricing ? (
            <CommandGroup heading="Plans">
              <CommandItem value="Plans Pricing" onSelect={() => go("/pricing")}>
                <Tag aria-hidden="true" />
                Pricing
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
