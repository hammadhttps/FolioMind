import type { BookCardProps } from "@/components/foliomind/book-card";
import type { ProjectRow } from "@/components/foliomind/projects-table";
import type { CatalogBookCard, PublicBook } from "@foliomind/contracts";
import type { PublisherProfileView } from "@/components/foliomind/screens/publisher-profile";
import type { CollectionView } from "@/components/foliomind/screens/my-library";
import type { SignInMethodView } from "@/components/foliomind/screens/settings";
import type { UploadAllowanceView } from "@/components/foliomind/upload-dialog";
import type { LibraryCard } from "@/lib/library/view";
import type { StudioState } from "@foliomind/contracts";
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
  bookDocumentId: null,
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

export const SAMPLE_BOOK: PublicBook = {
  id: "00000000-0000-4000-8000-000000000501",
  revisionId: "00000000-0000-4000-8000-000000000502",
  title: "Rivers of the Quiet City",
  author: "Sample Author",
  publisher: { name: "Sample Press", slug: "sample-press" },
  description:
    "Sample description for layout review. A real listing shows the publisher's description of the book here.",
  language: "en",
  categories: [{ slug: "environment", name: "Environment" }],
  coverUrl: null,
  pageCount: 184,
  licenseStatement: "Sample license statement. Real listings show the publisher's licensing terms.",
  publishedAt: "2026-01-05T00:00:00.000Z",
  documentId: "00000000-0000-4000-8000-000000000503",
  versionId: "00000000-0000-4000-8000-000000000504",
};

export const SAMPLE_CATALOG_BOOKS: CatalogBookCard[] = SAMPLE_BOOKS.slice(0, 3).map(
  (book, index) => ({
    id: `00000000-0000-4000-8000-00000000051${index}`,
    title: book.title,
    author: book.author ?? "Sample Author",
    language: "en",
    coverUrl: null,
    categories: book.category ? [{ slug: book.category.toLowerCase(), name: book.category }] : [],
    publisher: { slug: "sample-press", name: "Sample Press" },
    publishedAt: "2026-01-05T00:00:00.000Z",
  }),
);

export const SAMPLE_PUBLISHER: PublisherProfileView = {
  id: "00000000-0000-4000-8000-000000000520",
  name: "Sample Press",
  slug: "sample-press",
  bio: "Sample biography for layout review. Real profiles show the publisher's own description.",
  website: "https://example.com",
  avatarUrl: null,
  bookCount: 3,
  followers: 12,
};

const SAMPLE_VERSION = "00000000-0000-4000-8000-0000000000a1";
const SAMPLE_SECTIONS = [
  "00000000-0000-4000-8000-0000000000b1",
  "00000000-0000-4000-8000-0000000000b2",
  "00000000-0000-4000-8000-0000000000b3",
] as const;

export const SAMPLE_STUDIO_EMPTY: StudioState = {
  id: "00000000-0000-4000-8000-0000000000c1",
  title: "Sample: Urban heat report",
  mode: "research",
  status: "draft",
  prompt: "",
  settings: { audience: "", length: "medium", pageSize: "A4", cover: false, contents: false },
  template: "academic-report",
  outline: [],
  revisionCounter: 0,
  content: { type: "doc", content: [] },
  archived: false,
  firstDraftDone: false,
  sources: [{ versionId: SAMPLE_VERSION, title: "Sample: Harbor plan", available: true }],
  proposals: [],
  job: null,
  revisions: [],
  exports: [],
  allowance: {
    planCode: "free",
    projects: { used: 0, limit: 2 },
    regenerations: { used: 0, limit: 10 },
    reexports: { used: 0, limit: 10 },
    resetsAt: "2030-01-01T00:00:00.000Z",
  },
  charges: { outline: "project", draft: "none" },
};

export const SAMPLE_STUDIO_DRAFT: StudioState = {
  ...SAMPLE_STUDIO_EMPTY,
  status: "editing",
  prompt: "Sample: a report on urban heat for first-year students.",
  firstDraftDone: true,
  revisionCounter: 3,
  outline: [
    { id: SAMPLE_SECTIONS[0], heading: "Sample: Why cities run hot", notes: "Causes." },
    { id: SAMPLE_SECTIONS[1], heading: "Sample: What cools a street", notes: "Measures." },
    { id: SAMPLE_SECTIONS[2], heading: "Sample: Where to start", notes: "Priorities." },
  ],
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2, sectionId: SAMPLE_SECTIONS[0] },
        content: [{ type: "text", text: "Sample: Why cities run hot" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "This is labelled sample text for the dev gallery" },
          {
            type: "citation",
            attrs: {
              label: "1",
              chunkId: null,
              versionId: SAMPLE_VERSION,
              pageStart: 3,
              pageEnd: 3,
              draftHash: null,
            },
          },
          { type: "text", text: "." },
        ],
      },
    ],
  },
  revisions: [
    {
      id: "00000000-0000-4000-8000-0000000000d1",
      revisionNo: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
    },
  ],
  charges: { outline: "regeneration", draft: "regeneration" },
};
