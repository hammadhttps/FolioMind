import type { LibraryEntry } from "@foliomind/domain";

/** The serializable shape My Library's client components receive. */
export interface LibraryCard {
  id: string;
  documentId: string | null;
  bookId: string | null;
  title: string;
  author: string | null;
  kind: LibraryEntry["kind"];
  status: LibraryEntry["status"];
  addedAt: string;
  lastOpenedAt: string | null;
  collectionIds: string[];
}

export function toLibraryCard(entry: LibraryEntry): LibraryCard {
  return {
    ...entry,
    addedAt: entry.addedAt.toISOString(),
    lastOpenedAt: entry.lastOpenedAt?.toISOString() ?? null,
  };
}
