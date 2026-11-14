"use client";

import { languageName, MODERATION_PAGE_SIZE, REPORT_REASON_LABELS } from "@foliomind/contracts";
import { SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import { CircleCheck, ExternalLink, FileText, Gavel, Inbox, ShieldOff, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { debounce, useQueryStates } from "nuqs";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  decideSubmissionAction,
  resolveReportAction,
  takedownBookAction,
} from "@/lib/admin/actions";
import type {
  KeysetPageView,
  ReportRowView,
  SubmissionDetailView,
  SubmissionRowView,
} from "@/lib/admin/view";
import { formatDate, formatDateTime } from "@/lib/format";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { FIRST_KEYSET_PAGE, moderationParsers } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { BookCover } from "../book-cover";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";
import { StatusAlert } from "../status-alert";
import { StatusChip } from "../status-chip";
import { KeysetPager } from "./keyset-pager";
import { ReasonDialog, type DecisionResult } from "./reason-dialog";

export type ModerationData =
  | { type: "submission"; page: KeysetPageView<SubmissionRowView> }
  | { type: "report"; page: KeysetPageView<ReportRowView> };

const EMPTY: ModerationData = {
  type: "submission",
  page: { items: [], nextCursor: null, prevCursor: null },
};

function afterDecision(result: DecisionResult | null, success: string, refresh: () => void) {
  if (result?.ok) {
    toast.success(success);
    refresh();
  } else if (result?.code === "rate_limited") {
    showRateLimitToast(result.retryAfterSeconds);
  }
  return result;
}

/**
 * Content Moderation (Sections 5 row 16 and 20 #16): pending submissions and
 * open reports, oldest first, with reasoned decisions. Approving swaps the
 * live revision; rejecting leaves the last approved one live; a takedown
 * removes the book at once. Every decision is audited.
 */
export function ModerationScreen({
  data = EMPTY,
  counts = { submissions: 0, reports: 0 },
  review = null,
}: {
  data?: ModerationData;
  counts?: { submissions: number; reports: number };
  review?: SubmissionDetailView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(moderationParsers, {
    shallow: false,
    startTransition,
  });
  const [term, setTerm] = useState(params.q);
  const refresh = () => router.refresh();

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null, ...FIRST_KEYSET_PAGE },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  const tabs = [
    { type: "submission" as const, label: "Submissions", count: counts.submissions },
    { type: "report" as const, label: "Reports", count: counts.reports },
  ];

  return (
    <div className="space-y-6">
      <PageHeading
        title="Content moderation"
        description="Review book submissions and reports, with a reason for every decision."
      />
      <nav aria-label="Moderation queues" className="flex gap-1 border-b">
        {tabs.map((tab) => {
          const current = data.type === tab.type;
          return (
            <button
              key={tab.type}
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => {
                setTerm("");
                void setParams({
                  type: tab.type,
                  status: null,
                  q: null,
                  review: null,
                  ...FIRST_KEYSET_PAGE,
                });
              }}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
                current
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count > 0 ? <Badge variant="soft">{tab.count}</Badge> : null}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search by title or author"
          placeholder="Search by title or author"
          className="sm:max-w-xs"
        />
        <div className="flex gap-1 sm:ml-auto" role="group" aria-label="Show">
          {(["open", "decided"] as const).map((status) => (
            <Button
              key={status}
              variant={params.status === status ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={params.status === status}
              onClick={() =>
                void setParams({ status: status === "open" ? null : status, ...FIRST_KEYSET_PAGE })
              }
            >
              {status === "open" ? (data.type === "submission" ? "Waiting" : "Open") : "Decided"}
            </Button>
          ))}
        </div>
      </div>

      <div aria-busy={pending} className={cn(pending && "opacity-60")}>
        {data.type === "submission" ? (
          <SubmissionsTable
            rows={data.page.items}
            decided={params.status === "decided"}
            onReview={(id) => void setParams({ review: id })}
          />
        ) : (
          <ReportsTable
            rows={data.page.items}
            decided={params.status === "decided"}
            onDone={refresh}
          />
        )}
      </div>

      <KeysetPager
        start={params.start}
        count={data.page.items.length}
        pageSize={MODERATION_PAGE_SIZE}
        nextCursor={data.page.nextCursor}
        prevCursor={data.page.prevCursor}
        onPage={(page) => void setParams(page)}
      />

      <Sheet
        open={Boolean(review)}
        onOpenChange={(next) => (!next ? void setParams({ review: null }) : undefined)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {review ? (
            <SubmissionReview
              review={review}
              onDone={() => {
                void setParams({ review: null });
                refresh();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SubmissionsTable({
  rows,
  decided,
  onReview,
}: {
  rows: SubmissionRowView[];
  decided: boolean;
  onReview: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Gavel}
        title={decided ? "No decisions yet." : "All caught up."}
        description={
          decided
            ? "Approved and rejected submissions appear here."
            : "New book submissions will wait here for review."
        }
        actions={
          decided ? null : (
            <Button asChild variant="outline">
              <Link href="/dashboard/publishing">Go to publishing</Link>
            </Button>
          )
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Book</TableHead>
            <TableHead>Publisher</TableHead>
            <TableHead>{decided ? "Decision" : "PDF"}</TableHead>
            <TableHead>{decided ? "Decided" : "Submitted"}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-[18rem]">
                <p className="truncate font-medium">{row.title}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {row.author || "No author yet"} · Revision {row.revisionNo}
                  {row.isUpdate ? " · Update to a live book" : ""}
                </p>
              </TableCell>
              <TableCell className="max-w-[12rem] truncate">{row.publisherName}</TableCell>
              <TableCell>
                {decided ? (
                  row.status === "approved" ? (
                    <StatusChip status="ready" label="Approved" />
                  ) : (
                    <StatusChip status="failed" label="Rejected" />
                  )
                ) : row.sourceStatus === "ready" ? (
                  <StatusChip status="ready" label="Ready" />
                ) : (
                  <StatusChip status="processing" label="Processing" />
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(row.updatedAt)}</TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => onReview(row.id)}>
                  {decided ? "View" : "Review"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SubmissionReview({
  review,
  onDone,
}: {
  review: SubmissionDetailView;
  onDone: () => void;
}) {
  const waiting = review.status === "pending";
  return (
    <div className="space-y-5 pb-6">
      <SheetHeader>
        <SheetTitle className="[overflow-wrap:anywhere]">{review.title}</SheetTitle>
        <SheetDescription>
          Revision {review.revisionNo} by {review.publisherName}
          {review.isUpdate ? " · an update to a book that's live" : " · a new listing"}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4">
        {!waiting ? (
          <StatusAlert
            tone={review.status === "approved" ? "success" : "error"}
            title={review.status === "approved" ? "Approved" : "Rejected"}
          >
            {review.reviewReason ?? "No note was added."}
          </StatusAlert>
        ) : null}
        <div className="flex gap-4">
          <div className="w-24 shrink-0">
            <BookCover
              id={review.bookId}
              title={review.title}
              author={review.author}
              imageUrl={review.coverUrl}
              sizes="96px"
            />
          </div>
          <dl className="min-w-0 space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Author</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{review.author}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Language and categories</dt>
              <dd>
                {languageName(review.language)} ·{" "}
                {review.categories.map((category) => category.name).join(", ") || "None"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">PDF</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="truncate">{review.source.fileName}</span>
                {review.source.pageCount ? <span>· {review.source.pageCount} pages</span> : null}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/admin/submissions/${review.id}/source`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText aria-hidden="true" />
              Open the PDF
            </a>
          </Button>
          {review.bookStatus === "published" ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/books/${review.bookId}`} target="_blank">
                <ExternalLink aria-hidden="true" />
                Live listing
              </Link>
            </Button>
          ) : null}
        </div>
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Description</h3>
          <p className="text-sm/relaxed [overflow-wrap:anywhere] whitespace-pre-line">
            {review.description}
          </p>
        </section>
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">License statement</h3>
          <p className="text-sm/relaxed [overflow-wrap:anywhere] whitespace-pre-line">
            {review.licenseStatement}
          </p>
        </section>
        {review.live ? (
          <section className="space-y-1 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">Live now: revision {review.live.revisionNo}</h3>
            <p className="text-sm font-medium">{review.live.title}</p>
            <p className="line-clamp-4 text-sm text-muted-foreground">{review.live.description}</p>
          </section>
        ) : null}
        {waiting ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {review.sourceStatus !== "ready" ? (
              <StatusAlert tone="warning" className="w-full">
                The PDF is still being processed, so it can&apos;t be approved yet.
              </StatusAlert>
            ) : null}
            <ReasonDialog
              trigger={
                <Button disabled={review.sourceStatus !== "ready"}>
                  <CircleCheck aria-hidden="true" />
                  Approve
                </Button>
              }
              title="Approve this submission?"
              description="It becomes the live listing at once and the publisher's followers are told."
              confirmLabel="Approve"
              required={false}
              onSubmit={async (reason) =>
                afterDecision(
                  await decideSubmissionAction({
                    revisionId: review.id,
                    action: "approve",
                    reason,
                  }).catch(() => null),
                  "Approved. It's live in the library.",
                  onDone,
                )
              }
            />
            <ReasonDialog
              trigger={
                <Button variant="outline">
                  <X aria-hidden="true" />
                  Reject
                </Button>
              }
              title="Reject this submission?"
              description="The publisher sees your reason. A live listing stays as it is."
              confirmLabel="Reject"
              required
              onSubmit={async (reason) =>
                afterDecision(
                  await decideSubmissionAction({
                    revisionId: review.id,
                    action: "reject",
                    reason,
                  }).catch(() => null),
                  "Rejected. The publisher has been told why.",
                  onDone,
                )
              }
            />
          </div>
        ) : null}
        {review.bookStatus === "published" || review.bookStatus === "unpublished" ? (
          <div className="border-t pt-4">
            <TakedownButton bookId={review.bookId} onDone={onDone} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TakedownButton({
  bookId,
  reportId,
  onDone,
  size = "default",
}: {
  bookId: string;
  reportId?: string;
  onDone: () => void;
  size?: "default" | "sm";
}) {
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size={size} className="text-error">
          <ShieldOff aria-hidden="true" />
          Take down
        </Button>
      }
      title="Take this book down?"
      description="It leaves the library and reading access ends at once. Open reports about it are resolved with your reason, which the publisher sees."
      confirmLabel="Take down"
      required
      destructive
      onSubmit={async (reason) =>
        afterDecision(
          await takedownBookAction({ bookId, action: "takedown", reason, reportId }).catch(
            () => null,
          ),
          "Taken down.",
          onDone,
        )
      }
    />
  );
}

function ReportsTable({
  rows,
  decided,
  onDone,
}: {
  rows: ReportRowView[];
  decided: boolean;
  onDone: () => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={decided ? "No decided reports yet." : "All caught up."}
        description={
          decided
            ? "Resolved and dismissed reports appear here."
            : "Reports about catalog content will appear here."
        }
      />
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="font-medium [overflow-wrap:anywhere]">
                {row.bookStatus === "published" ? (
                  <Link
                    href={`/books/${row.bookId}`}
                    className="underline-offset-4 hover:underline"
                    target="_blank"
                  >
                    {row.bookTitle}
                  </Link>
                ) : (
                  row.bookTitle
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {REPORT_REASON_LABELS[row.reason]} · filed {formatDateTime(row.createdAt)}
                {row.bookStatus !== "published" ? ` · book is ${row.bookStatus}` : ""}
              </p>
            </div>
            {decided ? (
              <StatusChip
                status={row.status === "resolved" ? "ready" : "draft"}
                label={row.status === "resolved" ? "Resolved" : "Dismissed"}
              />
            ) : (
              <StatusChip status="pending" label="Open" />
            )}
          </div>
          {row.details ? (
            <p className="text-sm/relaxed [overflow-wrap:anywhere] whitespace-pre-line">
              {row.details}
            </p>
          ) : null}
          {decided && row.resolution ? (
            <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
              Note: {row.resolution}
            </p>
          ) : null}
          {!decided ? (
            <div className="flex flex-wrap gap-2">
              <ReasonDialog
                trigger={<Button size="sm">Resolve</Button>}
                title="Resolve this report?"
                description="Use this when you've dealt with the problem, for example by contacting the publisher."
                confirmLabel="Resolve"
                required={false}
                onSubmit={async (reason) =>
                  afterDecision(
                    await resolveReportAction({
                      reportId: row.id,
                      action: "resolve",
                      reason,
                    }).catch(() => null),
                    "Report resolved.",
                    onDone,
                  )
                }
              />
              <ReasonDialog
                trigger={
                  <Button size="sm" variant="outline">
                    Dismiss
                  </Button>
                }
                title="Dismiss this report?"
                description="The book stays as it is."
                confirmLabel="Dismiss"
                required={false}
                onSubmit={async (reason) =>
                  afterDecision(
                    await resolveReportAction({
                      reportId: row.id,
                      action: "dismiss",
                      reason,
                    }).catch(() => null),
                    "Report dismissed.",
                    onDone,
                  )
                }
              />
              {row.bookStatus === "published" || row.bookStatus === "unpublished" ? (
                <TakedownButton bookId={row.bookId} reportId={row.id} onDone={onDone} size="sm" />
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
