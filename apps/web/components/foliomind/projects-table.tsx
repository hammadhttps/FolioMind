"use client";

import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectRow } from "@/lib/projects/view";
import { ProjectRowActions } from "./projects/project-row-actions";
import { StatusChip } from "./status-chip";

export type { ProjectRow };

const features = tableFeatures({});
const column = createColumnHelper<typeof features, ProjectRow>();

const columns = column.columns([
  column.accessor("title", {
    header: "Project",
    cell: ({ row }) => (
      <div className="flex min-w-[220px] items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
          <FileText className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <Link
            href={`/dashboard/projects/${row.original.id}`}
            className="block truncate font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/70"
          >
            {row.original.title}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">
            {row.original.subtitle}
          </span>
        </span>
      </div>
    ),
  }),
  column.accessor("status", {
    header: "Status",
    cell: ({ row }) => <StatusChip status={row.original.status} label={row.original.statusLabel} />,
  }),
  column.accessor("updatedLabel", {
    header: "Updated",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted-foreground">{getValue()}</span>
    ),
  }),
  column.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <ProjectRowActions project={row.original} />,
  }),
]);

/**
 * Projects table (Section 19): horizontal-overflow wrapper, hover rows, status
 * chip and an icon action menu. Sorting and paging happen on the server (Section 24).
 */
export function ProjectsTable({ data, empty }: { data: ProjectRow[]; empty: ReactNode }) {
  const table = useTable({ features, columns, data });
  const rows = table.getRowModel().rows;

  // No rows: show the empty state at full width instead of inside the scrolling table.
  if (rows.length === 0) {
    return <div className="rounded-xl border bg-card p-4">{empty}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table className="min-w-[560px]">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="h-11 px-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="hover:bg-muted/60">
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="px-4 py-3">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
