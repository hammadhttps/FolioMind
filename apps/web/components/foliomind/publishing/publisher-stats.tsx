import { BookOpen, Bookmark, Users } from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "../empty-state";
import { MetricCard } from "../metric-card";
import { Panel } from "../panel";

export interface PublisherStatsView {
  days: number;
  reads: number;
  saves: number;
  followers: number;
  books: { id: string; title: string; reads: number; saves: number }[];
}

/**
 * Aggregate reads, saves and followers (Section 7: basic counts only). Reads
 * count once per reader, book and day; nobody's identity or questions are shown.
 */
export function PublisherStats({ stats }: { stats: PublisherStatsView }) {
  return (
    <div className="space-y-6">
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-3">
        <MetricCard label={`Reads, last ${stats.days} days`} value={stats.reads} icon={BookOpen} />
        <MetricCard label={`Saves, last ${stats.days} days`} value={stats.saves} icon={Bookmark} />
        <MetricCard label="Followers" value={stats.followers} icon={Users} />
      </section>
      <Panel
        title="By book"
        description="Reads count once per reader and day. Publishers never see who read or what they asked."
      >
        {stats.books.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={BookOpen}
            title="No published books yet."
            description="Counts appear once a book has been approved and readers open it."
          />
        ) : (
          <div className="overflow-x-auto px-5 pb-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Book</TableHead>
                  <TableHead className="text-right">Reads</TableHead>
                  <TableHead className="text-right">Saves</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.books.map((book) => (
                  <TableRow key={book.id}>
                    <TableCell className="max-w-[16rem] truncate">
                      <Link
                        href={`/dashboard/publishing?book=${book.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {book.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{book.reads}</TableCell>
                    <TableCell className="text-right tabular-nums">{book.saves}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}
