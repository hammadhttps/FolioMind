import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BookCover } from "./book-cover";
import { ProgressBar } from "./progress-bar";

export interface BookCardProps {
  id: string;
  title: string;
  author?: string | null;
  category?: string | null;
  label?: string | null;
  /** A publisher's uploaded cover; the CSS cover art otherwise. */
  coverUrl?: string | null;
  href: string;
  /** Reading progress 0–100 for "Pick up where you left off". */
  progress?: number | null;
  /** Status chip or a "Local PDF"-style badge under the title. */
  badge?: ReactNode;
  /** Save/bookmark control placed over the cover's corner (keeps its own focus). */
  action?: ReactNode;
  className?: string;
}

/** Illustrated cover, title, author, category and arrow (Section 20); the cover opens details. */
export function BookCard({
  id,
  title,
  author,
  category,
  label,
  coverUrl,
  href,
  progress,
  badge,
  action,
  className,
}: BookCardProps) {
  return (
    <article className={cn("group relative flex min-w-0 flex-col gap-3", className)}>
      <div className="relative rounded-xl bg-muted px-[16%] pt-6 pb-7 transition-colors group-hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_4%)]">
        <BookCover
          id={id}
          title={title}
          author={author}
          label={label}
          imageUrl={coverUrl}
          className="transition-transform duration-200 group-hover:-translate-y-1"
        />
        {action ? <div className="absolute top-2 right-2 z-10">{action}</div> : null}
      </div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.9375rem] font-semibold">
            <Link
              href={href}
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:ring-3 focus-visible:ring-ring/70"
            >
              {title}
            </Link>
          </h3>
          {author ? <p className="truncate text-sm text-muted-foreground">{author}</p> : null}
          {category ? (
            <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{category}</p>
          ) : null}
        </div>
        <ArrowUpRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
          aria-hidden="true"
        />
      </div>
      {badge ? <div className="relative">{badge}</div> : null}
      {progress !== undefined ? <ProgressBar value={progress} label="Read" /> : null}
    </article>
  );
}
