import { isTerminalJobStatus, jobErrorMessage } from "@foliomind/contracts";
import { canRetryJob, type LibraryEntry } from "@foliomind/domain";

/** The processing state a card shows: phase while running, the reason after a failure. */
export interface LibraryJobView {
  id: string;
  kind: string;
  status: string;
  live: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  canRetry: boolean;
}

/** The serializable shape My Library's client components receive. */
export interface LibraryCard {
  id: string;
  documentId: string | null;
  bookId: string | null;
  bookDocumentId: string | null;
  title: string;
  author: string | null;
  kind: LibraryEntry["kind"];
  status: LibraryEntry["status"];
  addedAt: string;
  lastOpenedAt: string | null;
  collectionIds: string[];
  sourceUrl: string | null;
  readable: boolean;
  job: LibraryJobView | null;
}

export function toLibraryCard(entry: LibraryEntry): LibraryCard {
  const { job } = entry;
  return {
    ...entry,
    addedAt: entry.addedAt.toISOString(),
    lastOpenedAt: entry.lastOpenedAt?.toISOString() ?? null,
    job: job
      ? {
          id: job.id,
          kind: job.kind,
          status: job.status,
          live: !isTerminalJobStatus(job.status),
          errorCode: job.safeErrorCode,
          errorMessage: jobErrorMessage(job.safeErrorCode),
          canRetry: canRetryJob(job),
        }
      : null,
  };
}
