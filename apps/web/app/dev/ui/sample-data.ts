import type { BookCardProps } from "@/components/foliomind/book-card";
import type { ProjectRow } from "@/components/foliomind/projects-table";
import type { BookDetails } from "@/components/foliomind/screens/book-details";
import type { PublisherProfile } from "@/components/foliomind/screens/publisher-profile";
import type { CollectionView } from "@/components/foliomind/screens/my-library";
import type { SignInMethodView } from "@/components/foliomind/screens/settings";
import type { UploadAllowanceView } from "@/components/foliomind/upload-dialog";
import type { LibraryCard } from "@/lib/library/view";
import type { SessionUser } from "@/lib/auth/types";

/*
 * Labelled sample data for the development-only gallery (/dev/ui). Never import
 * this from a real route: real pages show genuine data or honest empty states.
 */

export const SAMPLE_USER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "Sample Reader",
  email: "sample.reader@example.com",
  picture: null,
  role: "admin",
  isAdmin: true,
  emailVerified: true,
  theme: "light",
};

export const SAMPLE_SIGN_IN_METHODS: SignInMethodView[] = [
  { provider: "google-oauth2", connected: true, email: "sample.reader@example.com", primary: true },
  { provider: "github", connected: false, email: null, primary: false },
];

export const SAMPLE_ALLOWANCE: UploadAllowanceView = {
  documents: 3,
  documentLimit: 5,
  storageBytes: 14 * 1024 * 1024,
  storageLimitBytes: 100 * 1024 * 1024,
};

export const SAMPLE_COLLECTIONS: CollectionView[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    name: "Thesis (sample)",
    description: null,
    itemCount: 2,
  },
];

const sampleCard = (n: number, title: string, status: LibraryCard["status"]): LibraryCard => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  documentId: `00000000-0000-4000-8000-00000000020${n}`,
  bookId: null,
  title,
  author: null,
  kind: "upload",
  status,
  addedAt: "2026-11-01T10:00:00.000Z",
  lastOpenedAt: null,
  collectionIds: n === 1 ? ["00000000-0000-4000-8000-0000000000c1"] : [],
  sourceUrl: null,
  readable: true,
  job:
    status === "ready"
      ? null
      : {
          id: `00000000-0000-4000-8000-00000000030${n}`,
          kind: "ingest-document",
          status: status === "processing" ? "running" : "failed",
          live: status === "processing",
          errorCode: status === "attention" ? "needs_ocr" : null,
          errorMessage:
            status === "attention"
              ? "This PDF looks scanned or has no selectable text. FolioMind can't read scanned pages yet, so it can't be searched or used for answers."
              : null,
          canRetry: false,
        },
});

export const SAMPLE_LIBRARY: LibraryCard[] = [
  sampleCard(1, "Sample: Field Notes on River Restoration", "ready"),
  sampleCard(2, "Sample: Margins and Grids", "processing"),
  sampleCard(3, "Sample: Scanned Handout", "attention"),
];

export const SAMPLE_BOOKS: BookCardProps[] = [
  {
    id: "sample-1",
    title: "Rivers of the Quiet City",
    author: "Sample Author",
    category: "Environment",
    label: "Sample",
    href: "/dev/ui/screens/book-details",
  },
  {
    id: "sample-2",
    title: "Designing for Slow Attention",
    author: "Sample Author",
    category: "Design",
    label: "Sample",
    href: "/dev/ui/screens/book-details",
  },
  {
    id: "sample-3",
    title: "Methods for Careful Readers",
    author: "Sample Author",
    category: "Research",
    label: "Sample",
    href: "/dev/ui/screens/book-details",
  },
  {
    id: "sample-4",
    title: "Soil, Shade and Water",
    author: "Sample Author",
    category: "Environment",
    label: "Sample",
    href: "/dev/ui/screens/book-details",
  },
  {
    id: "sample-5",
    title: "Notes on Making Things",
    author: "Sample Author",
    category: "Design",
    label: "Sample",
    href: "/dev/ui/screens/book-details",
  },
  {
    id: "sample-6",
    title: "A Field Guide to Sources",
    author: "Sample Author",
    category: "Research",
    label: "Sample",
    href: "/dev/ui/screens/book-details",
  },
];

export const SAMPLE_PROJECTS: ProjectRow[] = [
  {
    id: "sample-project-1",
    title: "Sample: Urban heat report",
    subtitle: "Academic Report · 3 sources",
    status: "ready",
    updatedLabel: "Sample date",
  },
  {
    id: "sample-project-2",
    title: "Sample: Study notes on design",
    subtitle: "Study Notes · 1 source",
    status: "processing",
    statusLabel: "Drafting",
    updatedLabel: "Sample date",
  },
  {
    id: "sample-project-3",
    title: "Sample: Literature review",
    subtitle: "Academic Report · 5 sources",
    status: "failed",
    statusLabel: "Export failed",
    updatedLabel: "Sample date",
  },
];

export const SAMPLE_BOOK: BookDetails = {
  id: "sample-1",
  title: "Rivers of the Quiet City",
  author: "Sample Author",
  publisher: { name: "Sample Press", slug: "sample-press" },
  description:
    "Sample description for layout review. A real listing shows the publisher's description of the book here.",
  category: "Environment",
  pageCount: 184,
  language: "English",
  edition: "Sample edition",
  updatedLabel: "Sample date",
  licenseStatement: "Sample license statement. Real listings show the publisher's licensing terms.",
};

export const SAMPLE_PUBLISHER: PublisherProfile = {
  name: "Sample Press",
  slug: "sample-press",
  biography:
    "Sample biography for layout review. Real profiles show the publisher's own description.",
  website: "https://example.com",
  books: SAMPLE_BOOKS.slice(0, 3),
};
