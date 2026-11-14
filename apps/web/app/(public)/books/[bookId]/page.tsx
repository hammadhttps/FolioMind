import { bookViewerState } from "@foliomind/domain";
import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportConcern } from "@/components/foliomind/catalog/report-dialog";
import { SaveBookButton } from "@/components/foliomind/catalog/save-book-button";
import { PublicPage } from "@/components/foliomind/public-page";
import { BookDetailsScreen } from "@/components/foliomind/screens/book-details";
import { SignInDialog } from "@/components/foliomind/sign-in-dialog";
import { loadPublicBook } from "@/lib/catalog/data";
import { getDb } from "@/lib/clients";
import { getSessionUser } from "@/lib/session";
import type { PublicBook } from "@foliomind/contracts";

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export async function generateMetadata({
  params,
}: PageProps<"/books/[bookId]">): Promise<Metadata> {
  const book = await loadPublicBook((await params).bookId);
  if (!book) return { title: "Book not found", robots: { index: false } };
  return {
    title: book.title,
    description: clip(book.description.replace(/\s+/g, " "), 160),
    alternates: { canonical: `/books/${book.id}` },
    openGraph: {
      title: book.title,
      description: clip(book.description.replace(/\s+/g, " "), 200),
      type: "book",
      // The cover is a public image; without one the site's default image is used.
      ...(book.coverUrl ? { images: [{ url: book.coverUrl, alt: `Cover of ${book.title}` }] } : {}),
    },
  };
}

/**
 * Book Details (Section 5 row 3). Only an approved, published listing renders;
 * anything else is the not-found page, so unpublished or removed books stay
 * hidden. The public part is cached under `book:{id}`; the reader's own state
 * (saved, reported) is read per request inside Suspense.
 */
export default async function BookPage({ params }: PageProps<"/books/[bookId]">) {
  const book = await loadPublicBook((await params).bookId);
  if (!book) notFound();
  return (
    <PublicPage>
      <BookDetailsScreen
        book={book}
        actions={
          <Suspense fallback={<ActionsSkeleton />}>
            <ReaderActions book={book} />
          </Suspense>
        }
        report={
          <Suspense fallback={null}>
            <ReportSlot book={book} />
          </Suspense>
        }
      />
    </PublicPage>
  );
}

function ActionsSkeleton() {
  return (
    <>
      <Skeleton className="h-11 w-40" />
      <Skeleton className="h-11 w-44" />
    </>
  );
}

async function ReaderActions({ book }: { book: PublicBook }) {
  const user = await getSessionUser();
  const viewer = user ? await bookViewerState(getDb(), user.id, book.id) : null;
  const readerHref = `/read/${book.documentId}`;
  const start = (
    <Button size="lg" asChild={Boolean(user)}>
      {user ? (
        <Link href={readerHref}>
          <BookOpen aria-hidden="true" />
          Start reading
        </Link>
      ) : (
        <>
          <BookOpen aria-hidden="true" />
          Start reading
        </>
      )}
    </Button>
  );
  return (
    <>
      {user ? start : <SignInDialog returnTo={readerHref}>{start}</SignInDialog>}
      <SaveBookButton
        bookId={book.id}
        title={book.title}
        saved={viewer?.saved ?? false}
        signedIn={Boolean(user)}
        returnTo={`/books/${book.id}`}
      />
    </>
  );
}

async function ReportSlot({ book }: { book: PublicBook }) {
  const user = await getSessionUser();
  const viewer = user ? await bookViewerState(getDb(), user.id, book.id) : null;
  return (
    <ReportConcern
      bookId={book.id}
      signedIn={Boolean(user)}
      isOwner={viewer?.isOwner ?? false}
      report={viewer?.report ? { status: viewer.report.status } : null}
      returnTo={`/books/${book.id}`}
    />
  );
}
