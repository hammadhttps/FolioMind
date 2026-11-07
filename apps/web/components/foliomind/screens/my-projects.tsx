"use client";

import {
  PROJECT_LIST_STATUSES,
  PROJECT_SORTS,
  SEARCH_MIN_LENGTH,
} from "@foliomind/contracts/search-params";
import { ChevronLeft, ChevronRight, FilePlus2, FileText } from "lucide-react";
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
import type { ProjectRow } from "@/lib/projects/view";
import { projectsParsers } from "@/lib/search-params";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { CreateProjectDialog } from "../projects/create-project-dialog";
import { ProjectsTable } from "../projects-table";
import { SearchField } from "../search-field";

const STATUS_LABELS: Record<(typeof PROJECT_LIST_STATUSES)[number], string> = {
  all: "All statuses",
  draft: "Draft",
  generating: "Generating",
  editing: "Editing",
  rendering: "Rendering",
  complete: "Complete",
  failed: "Failed",
};
const SORT_LABELS: Record<(typeof PROJECT_SORTS)[number], string> = {
  updated: "Recently updated",
  created: "Recently created",
  title: "Title",
};
const MODE_LABELS = { all: "All modes", research: "Research", general: "General writing" };
const TEMPLATE_LABELS = {
  all: "All templates",
  "academic-report": "Academic Report",
  "study-notes": "Study Notes",
};
const ARCHIVED_LABELS = { active: "Active", archived: "Archived" };

export interface ProjectsPageData {
  items: ProjectRow[];
  nextCursor: string | null;
  prevCursor: string | null;
  pageSize: number;
}

const EMPTY_PAGE: ProjectsPageData = {
  items: [],
  nextCursor: null,
  prevCursor: null,
  pageSize: 20,
};

/** Any filter change goes back to the first page (Section 24). */
const FIRST_PAGE = { after: null, before: null, start: null };

/**
 * My Projects (Section 20 #10): real projects with search, filters and sort in
 * the URL, and keyset Previous and Next.
 */
export function MyProjectsScreen({ page = EMPTY_PAGE }: { page?: ProjectsPageData }) {
  const [params, setParams] = useQueryStates(projectsParsers, { shallow: false });
  const [term, setTerm] = useState(params.q);

  const filtered =
    Boolean(params.q) ||
    params.status !== "all" ||
    params.mode !== "all" ||
    params.template !== "all" ||
    params.archived !== "active";

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null, ...FIRST_PAGE },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function clearFilters() {
    setTerm("");
    void setParams({
      q: null,
      status: null,
      mode: null,
      template: null,
      archived: null,
      ...FIRST_PAGE,
    });
  }

  const create = (
    <CreateProjectDialog
      trigger={
        <Button>
          <FilePlus2 aria-hidden="true" />
          Create a PDF
        </Button>
      }
    />
  );
  const first = params.start;
  const last = first + page.items.length - 1;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Your ideas, taking shape."
        description="Drafts and finished PDFs created from your prompts and research."
        actions={create}
      />

      {page.items.length > 0 || filtered ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <SearchField
            value={term}
            onValueChange={onSearch}
            label="Search your projects"
            placeholder="Search by title"
            className="sm:col-span-2 lg:w-60"
          />
          <FilterSelect
            label="Status"
            value={params.status}
            labels={STATUS_LABELS}
            onChange={(status) =>
              void setParams({
                status: status === "all" ? null : (status as typeof params.status),
                ...FIRST_PAGE,
              })
            }
          />
          <FilterSelect
            label="Mode"
            value={params.mode}
            labels={MODE_LABELS}
            onChange={(mode) =>
              void setParams({
                mode: mode === "all" ? null : (mode as typeof params.mode),
                ...FIRST_PAGE,
              })
            }
          />
          <FilterSelect
            label="Template"
            value={params.template}
            labels={TEMPLATE_LABELS}
            onChange={(template) =>
              void setParams({
                template: template === "all" ? null : (template as typeof params.template),
                ...FIRST_PAGE,
              })
            }
          />
          <FilterSelect
            label="Archived"
            value={params.archived}
            labels={ARCHIVED_LABELS}
            onChange={(archived) =>
              void setParams({
                archived: archived === "active" ? null : (archived as typeof params.archived),
                ...FIRST_PAGE,
              })
            }
          />
          <FilterSelect
            label="Sort by"
            value={params.sort}
            labels={SORT_LABELS}
            className="lg:ml-auto"
            onChange={(sort) =>
              void setParams({
                sort: sort === "updated" ? null : (sort as typeof params.sort),
                ...FIRST_PAGE,
              })
            }
          />
          {filtered ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      <ProjectsTable
        data={page.items}
        empty={
          filtered ? (
            <EmptyState
              variant="plain"
              icon={FileText}
              title="No projects match these filters."
              description="Try a broader search or clear your filters."
              actions={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              variant="plain"
              icon={FileText}
              title="No projects yet."
              description="Create your first PDF from a prompt or from your research sources."
              actions={create}
            />
          )
        }
      />

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
                  start: Math.max(1, first - page.pageSize),
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

function FilterSelect({
  label,
  value,
  labels,
  onChange,
  className,
}: {
  label: string;
  value: string;
  labels: Record<string, string>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={`h-10 w-full bg-card lg:w-40 ${className ?? ""}`}
        aria-label={label}
      >
        {/* Explicit text, so it isn't blank until the page has hydrated. */}
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(labels).map(([option, text]) => (
          <SelectItem key={option} value={option}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
