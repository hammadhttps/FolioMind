import "server-only";
import { languageName, type CatalogBookCard, type PublicBook } from "@foliomind/contracts";
import type { CatalogCardRecord, PublicBookRecord } from "@foliomind/domain";
import { storageFileUrl } from "@/lib/clients";

/*
 * Serializable views of catalog records for pages and client components.
 * Covers are public files by design (Section 25), so their storage URL may be
 * shown; source PDFs never are.
 */

export function coverImageUrl(fileKey: string | null): string | null {
  if (!fileKey) return null;
  try {
    return storageFileUrl(fileKey);
  } catch {
    // UploadThing isn't configured here: fall back to the CSS cover art.
    return null;
  }
}

export function toCardView(record: CatalogCardRecord): CatalogBookCard {
  return {
    id: record.id,
    title: record.title,
    author: record.author,
    language: record.language,
    coverUrl: coverImageUrl(record.coverKey),
    categories: record.categories,
    publisher: record.publisher,
    publishedAt: record.publishedAt.toISOString(),
  };
}

export function toPublicBook(record: PublicBookRecord): PublicBook {
  return {
    id: record.id,
    revisionId: record.revisionId,
    title: record.title,
    author: record.author,
    description: record.description,
    language: record.language,
    categories: record.categories,
    publisher: record.publisher,
    coverUrl: coverImageUrl(record.coverKey),
    pageCount: record.pageCount,
    licenseStatement: record.licenseStatement,
    publishedAt: record.publishedAt.toISOString(),
    documentId: record.documentId,
    versionId: record.versionId,
  };
}

export const bookLanguageLabel = languageName;
