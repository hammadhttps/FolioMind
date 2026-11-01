"use client";

import { SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import { FileUp, Library } from "lucide-react";
import Link from "next/link";
import { debounce, useQueryStates } from "nuqs";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { libraryParsers } from "@/lib/search-params";
import { EmptyState } from "../empty-state";
import { FilterTabs } from "../filter-tabs";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";
import { UploadDialog } from "../upload-dialog";

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "uploads", label: "Uploads" },
  { value: "saved", label: "Saved" },
  { value: "imported", label: "Imported" },
];

/** My Library (Section 20 #7); documents, saves and collections arrive in Phase 5. */
export function MyLibraryScreen() {
  const [params, setParams] = useQueryStates(libraryParsers, { shallow: false });
  const [term, setTerm] = useState(params.q);
  const filtered = Boolean(params.q) || params.type !== "all";

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function clearFilters() {
    setTerm("");
    void setParams({ q: null, type: null });
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Your personal bookshelf."
        description="Your uploads, imported articles and saved books in one place."
        actions={
          <UploadDialog
            trigger={
              <Button>
                <FileUp aria-hidden="true" />
                Upload PDF
              </Button>
            }
          />
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search your library"
          placeholder="Search by title"
          className="lg:max-w-sm"
        />
        <FilterTabs
          label="Document type"
          options={TYPE_OPTIONS}
          value={params.type}
          onValueChange={(type) =>
            void setParams({ type: type === "all" ? null : (type as typeof params.type) })
          }
        />
        <Select
          value={params.sort}
          onValueChange={(sort) =>
            void setParams({ sort: sort === "opened" ? null : (sort as typeof params.sort) })
          }
        >
          <SelectTrigger className="h-10 w-full bg-card sm:w-48 lg:ml-auto" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opened">Recently opened</SelectItem>
            <SelectItem value="added">Recently added</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="sr-only" aria-live="polite">
        {filtered ? "No documents match these filters." : "Your library is empty."}
      </p>

      {filtered ? (
        <EmptyState
          icon={Library}
          title="No documents match these filters."
          description="Try a broader search or clear your filters."
          actions={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={Library}
          title="Nothing on your shelf yet."
          description="Upload a PDF, import an article or save a book from the library to start reading."
          actions={
            <>
              <UploadDialog trigger={<Button variant="outline">Upload PDF</Button>} />
              <Button asChild variant="ghost">
                <Link href="/library">Explore the library</Link>
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
