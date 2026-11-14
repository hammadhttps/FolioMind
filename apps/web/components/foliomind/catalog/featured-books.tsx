import type { CatalogBookCard } from "@foliomind/contracts";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BookCard } from "../book-card";

/** Home's featured section (Section 5 row 1): the newest approved books, or nothing. */
export function FeaturedBooks({ books }: { books: CatalogBookCard[] }) {
  if (books.length === 0) return null;
  return (
    <section aria-labelledby="featured-heading" className="mt-12 space-y-6 md:mt-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="featured-heading"
            className="font-serif text-2xl font-semibold tracking-[-0.01em]"
          >
            New in the library
          </h2>
          <p className="text-muted-foreground">
            Recently approved books from independent publishers.
          </p>
        </div>
        <Button asChild variant="ghost">
          <Link href="/library">
            See all books
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-6">
        {books.map((book) => (
          <li key={book.id}>
            <BookCard
              id={book.id}
              title={book.title}
              author={book.author}
              category={book.categories[0]?.name ?? null}
              label={book.publisher.name}
              coverUrl={book.coverUrl}
              href={`/books/${book.id}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
