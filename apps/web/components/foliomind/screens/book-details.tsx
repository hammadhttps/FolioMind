import type { PublicBook } from "@foliomind/contracts";
import { languageName } from "@foliomind/contracts";
import { ArrowLeft, Building2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { BookCover } from "../book-cover";
import { StatusAlert } from "../status-alert";

/**
 * Book Details (Sections 5 row 3 and 20 #3): title, cover, description, author,
 * language, categories, page count, publisher, updated date and the licensing
 * statement. Reading, saving and reporting arrive in the `actions` and `report`
 * slots, which depend on who is looking.
 */
export function BookDetailsScreen({
  book,
  actions,
  report,
}: {
  book: PublicBook;
  actions?: ReactNode;
  report?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="-ml-3 text-muted-foreground">
        <Link href="/library">
          <ArrowLeft aria-hidden="true" />
          Back to the library
        </Link>
      </Button>

      <div className="grid gap-8 md:grid-cols-[minmax(240px,360px)_minmax(0,1fr)] lg:gap-12">
        <div className="rounded-2xl bg-primary-subtle px-[18%] py-10 md:py-12">
          <BookCover
            id={book.id}
            title={book.title}
            author={book.author}
            label={book.publisher.name}
            imageUrl={book.coverUrl}
            sizes="(min-width: 761px) 260px, 60vw"
            priority
            decorative={false}
          />
        </div>

        <div className="min-w-0 space-y-5">
          {book.categories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {book.categories.map((category) => (
                <Badge key={category.slug} variant="soft" asChild>
                  <Link href={`/library?category=${category.slug}`}>{category.name}</Link>
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            <h1 className="font-serif text-[2rem]/tight font-semibold tracking-[-0.01em] text-balance [overflow-wrap:anywhere] md:text-[2.5rem]/tight">
              {book.title}
            </h1>
            <p className="text-base text-muted-foreground">
              by {book.author} ·{" "}
              <Link
                href={`/publishers/${book.publisher.slug}`}
                className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
              >
                <Building2 className="size-4" aria-hidden="true" />
                {book.publisher.name}
              </Link>
            </p>
          </div>
          <p className="max-w-2xl text-base/relaxed [overflow-wrap:anywhere] whitespace-pre-line">
            {book.description}
          </p>

          <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Meta term="Pages" value={book.pageCount ? String(book.pageCount) : "—"} />
            <Meta term="Language" value={languageName(book.language)} />
            <Meta term="Updated" value={formatDate(book.publishedAt)} />
          </dl>

          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}

          <StatusAlert tone="info" title="License">
            <span className="[overflow-wrap:anywhere] whitespace-pre-line">
              {book.licenseStatement}
            </span>
          </StatusAlert>

          {report}
        </div>
      </div>
    </div>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
