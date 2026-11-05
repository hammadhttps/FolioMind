import { isTerminalJobStatus, jobErrorMessage } from "@foliomind/contracts";
import {
  canRetryJob,
  getReadableDocument,
  getReadingProgress,
  latestJobs,
  listAnnotations,
  listThreads,
  questionAllowance,
} from "@foliomind/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ReaderScreen } from "@/components/foliomind/screens/reader";
import { getDb } from "@/lib/clients";
import { toAnnotationItem } from "@/lib/reader/view";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Reader", robots: { index: false } };

/** A citation's page from the URL; a bad value is simply ignored (Section 24). */
const citationPage = z.coerce.number().int().min(1).max(100_000).optional().catch(undefined);

const STATUS_GROUP: Record<string, "ready" | "processing" | "attention"> = {
  ready: "ready",
  failed: "attention",
  needs_ocr: "attention",
};

/**
 * Reader (Section 20 #8). Access is checked on the server; anything the user
 * cannot read is a 404, so a document's existence is never revealed.
 */
export default async function ReaderPage({
  params,
  searchParams,
}: PageProps<"/read/[documentId]">) {
  const user = await requireUser();
  const documentId = z.uuid().safeParse((await params).documentId);
  if (!documentId.success) notFound();
  const initialPage = citationPage.parse((await searchParams).page);

  const db = getDb();
  const document = await getReadableDocument(db, user, documentId.data);
  if (!document) notFound();
  const [annotations, progress, jobs, threads, allowance] = await Promise.all([
    listAnnotations(db, user.id, document.version.id),
    getReadingProgress(db, user.id, document.version.id),
    // Processing state is the owner's only (Section 11: owner-safe job status).
    document.isOwner ? latestJobs(db, user.id, [document.id]) : null,
    listThreads(db, user.id, { documentId: document.id }),
    questionAllowance(db, user.id),
  ]);
  const job = jobs?.get(document.id) ?? null;

  return (
    <ReaderScreen
      document={{
        id: document.id,
        title: document.title,
        status: STATUS_GROUP[document.version.status] ?? "processing",
        job: job
          ? {
              id: job.id,
              live: !isTerminalJobStatus(job.status),
              errorMessage: jobErrorMessage(job.safeErrorCode),
              canRetry: canRetryJob(job),
            }
          : null,
      }}
      annotations={annotations.map(toAnnotationItem)}
      progress={progress ? { pageNumber: progress.pageNumber, position: progress.position } : null}
      initialPage={initialPage}
      chat={{ threads, allowance }}
    />
  );
}
