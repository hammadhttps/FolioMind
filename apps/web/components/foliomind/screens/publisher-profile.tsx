import { BookOpen, Building2, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BookCard, type BookCardProps } from "../book-card";
import { ComingSoonButton } from "../coming-soon";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";

export interface PublisherProfile {
  name: string;
  slug: string;
  biography: string;
  website?: string | null;
  books: BookCardProps[];
}

/** Publisher Profile layout (Section 20 #4); real listings and follows arrive in Phase 9. */
export function PublisherProfileScreen({ publisher }: { publisher: PublisherProfile }) {
  const count = publisher.books.length;
  return (
    <div className="space-y-6">
      <PageHeading
        title={publisher.name}
        description="Independent publisher"
        actions={
          <ComingSoonButton
            variant="outline"
            aria-pressed={false}
            reason="Following opens with publisher profiles"
          >
            <UserPlus aria-hidden="true" />
            Follow publisher
          </ComingSoonButton>
        }
      />

      <Card className="flex-row items-start gap-5 p-6">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary-subtle text-primary-subtle-foreground">
          <Building2 className="size-8" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-2">
          <p className="text-base/relaxed">{publisher.biography}</p>
          <p className="text-sm text-muted-foreground">
            {count === 1 ? "1 publication" : `${count} publications`}
          </p>
          {publisher.website ? (
            <a
              href={publisher.website}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className="text-sm text-link underline-offset-4 hover:underline"
            >
              {publisher.website.replace(/^https?:\/\//, "")}
            </a>
          ) : null}
        </div>
      </Card>

      {count > 0 ? (
        <ul className="grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3 2xl:grid-cols-4">
          {publisher.books.map((book) => (
            <li key={book.id}>
              <BookCard {...book} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No books here just yet."
          description="This publisher's approved books will appear here."
        />
      )}
    </div>
  );
}
