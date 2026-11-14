"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Previous and Next over keyset cursors with "Showing 26–50" instead of an
 * exact total (Section 24: large private and admin lists).
 */
export function KeysetPager({
  start,
  count,
  pageSize,
  nextCursor,
  prevCursor,
  onPage,
}: {
  start: number;
  count: number;
  pageSize: number;
  nextCursor: string | null;
  prevCursor: string | null;
  onPage: (page: { after: string | null; before: string | null; start: number }) => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {start}–{start + count - 1}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!prevCursor}
          onClick={() =>
            onPage({ before: prevCursor, after: null, start: Math.max(1, start - pageSize) })
          }
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!nextCursor}
          onClick={() => onPage({ after: nextCursor, before: null, start: start + count })}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
