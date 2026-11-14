import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { pageWindow } from "@/lib/catalog/urls";
import { cn } from "@/lib/utils";

/**
 * Page-number pagination (Section 24): previous, next and nearby pages as
 * links, so every page has a shareable URL and works without JavaScript.
 */
export function CatalogPagination({
  page,
  pages,
  hrefFor,
  className,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (pages <= 1) return null;
  const window = pageWindow(page, pages);
  return (
    <nav aria-label="Pages" className={cn("flex justify-center", className)}>
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page">
            <ChevronLeft aria-hidden="true" />
            <span className="hidden sm:inline">Previous</span>
          </PageLink>
        </li>
        {window.map((entry, index) =>
          entry === null ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={entry}>
              <Button
                asChild
                size="icon"
                variant={entry === page ? "outline" : "ghost"}
                className="min-w-9"
              >
                <Link
                  href={hrefFor(entry)}
                  aria-label={`Page ${entry}`}
                  aria-current={entry === page ? "page" : undefined}
                  scroll
                >
                  {entry}
                </Link>
              </Button>
            </li>
          ),
        )}
        <li>
          <PageLink href={page < pages ? hrefFor(page + 1) : null} label="Next page">
            <span className="hidden sm:inline">Next</span>
            <ChevronRight aria-hidden="true" />
          </PageLink>
        </li>
      </ul>
    </nav>
  );
}

function PageLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <Button variant="ghost" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost">
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}
