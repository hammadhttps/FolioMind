import "server-only";
import type {
  BookRevisionView,
  ListingStatus,
  PublisherAccount,
  PublisherBookRow,
  PublisherBookView,
} from "@foliomind/domain";
import { coverImageUrl } from "@/lib/catalog/view";

/* Serializable Publisher Dashboard views for client components. */

export type { ListingStatus };

export interface PublisherBookRowView {
  id: string;
  title: string;
  listingStatus: ListingStatus;
  live: boolean;
  coverUrl: string | null;
  updatedAt: string;
}

export function toBookRowView(row: PublisherBookRow): PublisherBookRowView {
  return {
    id: row.id,
    title: row.title,
    listingStatus: row.listingStatus,
    live: row.live,
    coverUrl: coverImageUrl(row.coverKey),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface RevisionEditorView {
  id: string;
  revisionNo: number;
  status: BookRevisionView["status"];
  title: string;
  author: string;
  description: string;
  language: string;
  categories: string[];
  licenseStatement: string;
  coverUrl: string | null;
  reviewReason: string | null;
  publishedAt: string | null;
  updatedAt: string;
  source: BookRevisionView["source"];
}

const toRevision = (revision: BookRevisionView): RevisionEditorView => ({
  ...revision,
  coverUrl: coverImageUrl(revision.coverKey),
  publishedAt: revision.publishedAt?.toISOString() ?? null,
  updatedAt: revision.updatedAt.toISOString(),
});

export interface BookEditorView {
  id: string;
  status: PublisherBookView["status"];
  listingStatus: ListingStatus;
  open: RevisionEditorView | null;
  live: RevisionEditorView | null;
  lastDecision: {
    revisionNo: number;
    status: "approved" | "rejected";
    reason: string | null;
    decidedAt: string;
  } | null;
  history: {
    id: string;
    revisionNo: number;
    status: string;
    reviewReason: string | null;
    updatedAt: string;
  }[];
  can: PublisherBookView["can"];
}

export function toBookEditorView(book: PublisherBookView): BookEditorView {
  return {
    id: book.id,
    status: book.status,
    listingStatus: book.listingStatus,
    open: book.open ? toRevision(book.open) : null,
    live: book.live ? toRevision(book.live) : null,
    lastDecision: book.lastDecision
      ? { ...book.lastDecision, decidedAt: book.lastDecision.decidedAt.toISOString() }
      : null,
    history: book.history.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    can: book.can,
  };
}

export interface PublisherAccountView {
  profile: {
    id: string;
    slug: string;
    displayName: string;
    bio: string;
    website: string | null;
    status: "applicant" | "approved" | "rejected" | "suspended";
    reviewReason: string | null;
    updatedAt: string;
  } | null;
  slugLocked: boolean;
}

export function toAccountView(account: PublisherAccount): PublisherAccountView {
  return {
    profile: account.profile
      ? {
          id: account.profile.id,
          slug: account.profile.slug,
          displayName: account.profile.displayName,
          bio: account.profile.bio,
          website: account.profile.website,
          status: account.profile.status,
          reviewReason: account.profile.reviewReason,
          updatedAt: account.profile.updatedAt.toISOString(),
        }
      : null,
    slugLocked: account.slugLocked,
  };
}
