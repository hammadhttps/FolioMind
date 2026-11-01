import { ArrowLeft, Bookmark, BookOpen, Building2, Flag } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookCover } from "../book-cover";
import { ComingSoonButton } from "../coming-soon";
import { StatusAlert } from "../status-alert";

export interface BookDetails {
  id: string;
  title: string;
  author: string;
  publisher: { name: string; slug: string };
  description: string;
  category: string;
  pageCount: number;
  language: string;
  edition?: string | null;
  updatedLabel: string;
  licenseStatement: string;
}

/**
 * Book Details layout (Section 20 #3). Phase 9 supplies approved books; until
 * then the route returns 404 for every ID and this view appears in /dev/ui.
 */
export function BookDetailsScreen({ book }: { book: BookDetails }) {
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
            label={book.edition}
            decorative={false}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <Badge variant="soft">{book.category}</Badge>
          <div className="space-y-2">
            <h1 className="font-serif text-[2rem]/tight font-semibold tracking-[-0.01em] text-balance md:text-[2.5rem]/tight">
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
          <p className="max-w-2xl text-base/relaxed">{book.description}</p>

          <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Meta term="Pages" value={String(book.pageCount)} />
            <Meta term="Language" value={book.language} />
            <Meta term="Edition" value={book.edition ?? "—"} />
            <Meta term="Updated" value={book.updatedLabel} />
          </dl>

          <div className="flex flex-wrap gap-3">
            <ComingSoonButton size="lg" reason="Reading opens with the catalog">
              <BookOpen aria-hidden="true" />
              Start reading
            </ComingSoonButton>
            <ComingSoonButton
              size="lg"
              variant="outline"
              aria-pressed={false}
              reason="Saving opens with the catalog"
            >
              <Bookmark aria-hidden="true" />
              Save to library
            </ComingSoonButton>
          </div>

          <StatusAlert tone="info" title="License">
            {book.licenseStatement}
          </StatusAlert>

          <ComingSoonButton
            variant="link"
            reason="Reports open with the catalog"
            className="text-muted-foreground"
          >
            <Flag aria-hidden="true" />
            Report a concern
          </ComingSoonButton>
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
