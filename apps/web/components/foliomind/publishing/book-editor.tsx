"use client";

import {
  BOOK_CATEGORIES_MAX,
  BOOK_DESCRIPTION_MAX,
  BOOK_LANGUAGES,
  BOOK_UPLOAD_REFUSALS,
  bookDraftSchema,
  isTerminalJobStatus,
  jobErrorMessage,
  type BookDraftInput,
} from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, PenLine, Send, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import {
  deleteBookDraftAction,
  removeCoverAction,
  reviseBookAction,
  saveBookDraftAction,
  submitBookAction,
  unpublishBookAction,
  withdrawSubmissionAction,
} from "@/lib/publishing/actions";
import type { BookEditorView, RevisionEditorView } from "@/lib/publishing/view";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { BookCover } from "../book-cover";
import { Panel } from "../panel";
import { fetchJob, jobQueryKey } from "../processing-status";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";
import { StatusChip } from "../status-chip";
import { FileDrop, useBookUpload } from "./book-upload";
import { ListingStatusChip } from "./listing-status";

type ActionResultLike = {
  ok: boolean;
  code?: string;
  formError?: string;
  retryAfterSeconds?: number;
};

function reportFailure(result: ActionResultLike | null, fallback: string) {
  if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
  else toast.error(result?.formError ?? fallback);
}

/**
 * The book editor on the Publisher Dashboard (Sections 5 row 12, 6
 * "Publishing", 25 and 28): the source PDF and its processing, the cover, the
 * listing details, submission and review feedback, revisions, unpublishing.
 */
export function BookEditor({
  book,
  categories,
}: {
  book: BookEditorView;
  categories: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const open = book.open;
  const editing = open?.status === "draft";
  const title = open?.title ?? book.live?.title ?? "Untitled book";
  const source = open?.source ?? book.live?.source ?? null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="-ml-3 text-muted-foreground">
        <Link href="/dashboard/publishing">
          <ArrowLeft aria-hidden="true" />
          All books
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] md:text-[1.75rem]">
            {title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <ListingStatusChip status={book.listingStatus} />
            {book.live && open ? (
              <span className="text-sm text-muted-foreground">
                Readers see revision {book.live.revisionNo} until revision {open.revisionNo} is
                approved.
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {source ? (
            <Button asChild variant="outline">
              <Link href={`/read/${source.documentId}`}>
                <FileText aria-hidden="true" />
                Preview PDF
              </Link>
            </Button>
          ) : null}
          {book.status === "published" ? (
            <Button asChild variant="outline">
              <Link href={`/books/${book.id}`}>
                <ExternalLink aria-hidden="true" />
                View listing
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Feedback book={book} onChanged={() => router.refresh()} />

      {!open && book.history.length === 0 ? (
        <Panel
          title="Upload the book's PDF"
          description="Your listing starts once the PDF is uploaded. You can add the details while it's processed."
        >
          <div className="px-5 pb-5">
            <SourceUpload bookId={book.id} onDone={() => router.refresh()} />
          </div>
        </Panel>
      ) : null}

      {open ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="order-2 space-y-6 xl:order-1">
            <DetailsForm
              key={`${open.id}:${open.updatedAt}`}
              bookId={book.id}
              revision={open}
              categories={categories}
              editable={editing}
              onChanged={() => router.refresh()}
            />
          </div>
          <div className="order-1 space-y-6 xl:order-2">
            <SourcePanel bookId={book.id} revision={open} editable={editing} />
            <CoverPanel bookId={book.id} revision={open} editable={editing} />
          </div>
        </div>
      ) : null}

      <History book={book} />
      <Manage book={book} />
    </div>
  );
}

function Feedback({ book, onChanged }: { book: BookEditorView; onChanged: () => void }) {
  const preview = useIsPreview();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<ActionResultLike>, success: string, failure: string) {
    if (preview) return;
    setBusy(true);
    const result = await action().catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      reportFailure(result, failure);
      return;
    }
    toast.success(success);
    onChanged();
  }

  if (book.listingStatus === "removed") {
    const reason = book.history.find((row) => row.reviewReason)?.reviewReason;
    return (
      <StatusAlert tone="error" title="This book was removed from the library by moderation">
        {reason ? <span className="whitespace-pre-line">{reason}</span> : null}
      </StatusAlert>
    );
  }
  if (book.open?.status === "pending") {
    return (
      <StatusAlert
        tone="info"
        title="Waiting for review"
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () => withdrawSubmissionAction(book.id),
                "Submission withdrawn. You can edit it again.",
                "We couldn't withdraw it. Please try again.",
              )
            }
          >
            <Undo2 aria-hidden="true" />
            Withdraw
          </Button>
        }
      >
        A moderator reviews every submission. Withdraw it if you need to change something first.
      </StatusAlert>
    );
  }
  const decision = book.lastDecision;
  const rejectedLatest = decision?.status === "rejected" && book.history[0]?.status === "rejected";
  return (
    <>
      {rejectedLatest && decision ? (
        <StatusAlert tone="error" title={`Revision ${decision.revisionNo} wasn't approved`}>
          {decision.reason ? (
            <span className="whitespace-pre-line">{decision.reason}</span>
          ) : (
            "Revise the listing and submit it again."
          )}
        </StatusAlert>
      ) : null}
      {book.can.revise ? (
        <StatusAlert
          tone="info"
          title={book.status === "published" ? "Update this listing" : "Revise and resubmit"}
          action={
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => reviseBookAction(book.id),
                  "A new draft is ready to edit.",
                  "We couldn't start a new revision. Please try again.",
                )
              }
            >
              <PenLine aria-hidden="true" />
              {book.status === "published" ? "Edit listing" : "Revise"}
            </Button>
          }
        >
          {book.status === "published"
            ? "Changes, including a new PDF, go through review. The approved version stays live meanwhile."
            : "Start a new revision from the last one, make your changes and submit it again."}
        </StatusAlert>
      ) : null}
    </>
  );
}

function SourceUpload({ bookId, onDone }: { bookId: string; onDone: () => void }) {
  const preview = useIsPreview();
  const [file, setFile] = useState<File | null>(null);
  const { upload, isUploading, progress, error, setError } = useBookUpload("source");

  async function submit() {
    if (!file || preview) return;
    if (await upload(file, { bookId })) {
      toast.success("PDF uploaded. It's being processed.");
      setFile(null);
      onDone();
    }
  }

  return (
    <div className="space-y-3">
      {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}
      <FileDrop
        kind="source"
        compact
        file={file}
        busy={isUploading}
        progress={progress}
        onFile={(next, problem) => {
          setError(problem ? BOOK_UPLOAD_REFUSALS[problem] : null);
          setFile(problem ? null : next);
        }}
      />
      {file ? (
        <div className="flex justify-end">
          <Button size="sm" disabled={isUploading} onClick={() => void submit()}>
            {isUploading ? <Spinner aria-hidden="true" /> : null}
            Upload PDF
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Polls the source's ingestion job until it ends, then refreshes the page. */
function SourceStatus({ revision }: { revision: RevisionEditorView }) {
  const router = useRouter();
  const { source } = revision;
  const processing = !["ready", "failed", "needs_ocr"].includes(source.status);
  const { data: job } = useQuery({
    queryKey: jobQueryKey(source.jobId ?? "none"),
    queryFn: () => fetchJob(source.jobId!),
    enabled: processing && Boolean(source.jobId),
    refetchInterval: (query) =>
      query.state.data && isTerminalJobStatus(query.state.data.status) ? false : 3000,
  });
  const ended = job ? isTerminalJobStatus(job.status) : false;
  useEffect(() => {
    if (processing && ended) router.refresh();
  }, [processing, ended, router]);

  if (source.status === "ready") {
    return (
      <StatusChip
        status="ready"
        label={source.pageCount ? `Ready · ${source.pageCount} pages` : "Ready"}
      />
    );
  }
  if (source.status === "needs_ocr") {
    return <StatusChip status="attention" label="No readable text: upload a text-based PDF" />;
  }
  if (source.status === "failed") {
    return (
      <StatusChip
        status="failed"
        label={jobErrorMessage(job?.errorCode ?? null) ?? "Couldn't be processed"}
      />
    );
  }
  return <StatusChip status="processing" label={job?.phaseLabel ?? "Processing"} />;
}

function SourcePanel({
  bookId,
  revision,
  editable,
}: {
  bookId: string;
  revision: RevisionEditorView;
  editable: boolean;
}) {
  const router = useRouter();
  const [replacing, setReplacing] = useState(false);
  return (
    <Panel
      title="Book PDF"
      description="What readers open. A new PDF needs approval like any change."
    >
      <div className="space-y-3 px-5 pb-5">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium">{revision.source.fileName}</span>
        </p>
        <SourceStatus revision={revision} />
        {editable ? (
          replacing ? (
            <SourceUpload
              bookId={bookId}
              onDone={() => {
                setReplacing(false);
                router.refresh();
              }}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
              Replace PDF
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  );
}

function CoverPanel({
  bookId,
  revision,
  editable,
}: {
  bookId: string;
  revision: RevisionEditorView;
  editable: boolean;
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const { upload, isUploading, progress, error, setError } = useBookUpload("cover");

  async function submit() {
    if (!file || preview) return;
    if (await upload(file, { bookId })) {
      toast.success("Cover added.");
      setFile(null);
      router.refresh();
    }
  }

  async function remove() {
    if (preview) return;
    setRemoving(true);
    const result = await removeCoverAction(bookId).catch(() => null);
    setRemoving(false);
    if (!result?.ok) {
      reportFailure(result, "We couldn't remove the cover. Please try again.");
      return;
    }
    router.refresh();
  }

  return (
    <Panel
      title="Cover"
      description="Optional. Without one, readers see a designed cover with the title."
    >
      <div className="space-y-3 px-5 pb-5">
        <div className="mx-auto w-32">
          <BookCover
            id={bookId}
            title={revision.title}
            author={revision.author || null}
            imageUrl={revision.coverUrl}
            sizes="128px"
          />
        </div>
        {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}
        {editable ? (
          <>
            <FileDrop
              kind="cover"
              compact
              file={file}
              busy={isUploading}
              progress={progress}
              onFile={(next, problem) => {
                setError(problem ? BOOK_UPLOAD_REFUSALS[problem] : null);
                setFile(problem ? null : next);
              }}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {revision.coverUrl && !file ? (
                <Button variant="ghost" size="sm" disabled={removing} onClick={() => void remove()}>
                  Remove cover
                </Button>
              ) : null}
              {file ? (
                <Button size="sm" disabled={isUploading} onClick={() => void submit()}>
                  {isUploading ? <Spinner aria-hidden="true" /> : null}
                  Upload cover
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function DetailsForm({
  bookId,
  revision,
  categories,
  editable,
  onChanged,
}: {
  bookId: string;
  revision: RevisionEditorView;
  categories: { slug: string; name: string }[];
  editable: boolean;
  onChanged: () => void;
}) {
  const preview = useIsPreview();
  const [formError, setFormError] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [rightsError, setRightsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<BookDraftInput>({
    resolver: zodResolver(bookDraftSchema),
    mode: "onTouched",
    defaultValues: {
      bookId,
      title: revision.title,
      author: revision.author,
      description: revision.description,
      language: (revision.language || "en") as BookDraftInput["language"],
      categories: revision.categories,
      licenseStatement: revision.licenseStatement,
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const description = useWatch({ control: form.control, name: "description" }) ?? "";
  const chosen = useWatch({ control: form.control, name: "categories" }) ?? [];

  // Section 28: long forms warn before unsaved changes are lost.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  function applyFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
    let focused = false;
    for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
      if (!messages?.[0]) continue;
      if (name === "rightsConfirmed") {
        setRightsError(messages[0]);
        continue;
      }
      form.setError(
        name as keyof BookDraftInput,
        { message: messages[0] },
        { shouldFocus: !focused },
      );
      focused = true;
    }
  }

  async function save(values: BookDraftInput) {
    setFormError(null);
    if (preview) return;
    const result = await saveBookDraftAction(values).catch(() => null);
    if (!result?.ok) {
      if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
      else setFormError(result?.formError ?? "We couldn't save the draft. Please try again.");
      applyFieldErrors(result?.fieldErrors);
      return;
    }
    toast.success("Draft saved.");
    form.reset(values);
    onChanged();
  }

  async function submit() {
    setFormError(null);
    setRightsError(null);
    if (!rights) {
      setRightsError("Confirm that you're authorized to share this book.");
      return;
    }
    if (preview) return;
    setSubmitting(true);
    const values = form.getValues();
    const result = await submitBookAction({ ...values, rightsConfirmed: true }).catch(() => null);
    setSubmitting(false);
    if (!result?.ok) {
      if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
      else setFormError(result?.formError ?? "We couldn't submit it. Please try again.");
      applyFieldErrors(result?.fieldErrors);
      return;
    }
    toast.success("Submitted for review. We'll let you know the decision.");
    form.reset(values);
    onChanged();
  }

  return (
    <Panel
      title="Listing details"
      description={
        editable
          ? "Save a draft at any time. Submitting checks every field and needs the PDF processed."
          : "This revision is waiting for review, so it can't be changed."
      }
    >
      <form
        className="space-y-4 px-5 pb-5"
        onSubmit={(event) => void form.handleSubmit(save)(event)}
        noValidate
      >
        {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
          <TextField form={form} name="title" label="Title" maxLength={200} errors={errors} />
          <TextField form={form} name="author" label="Author" maxLength={200} errors={errors} />
          <Field data-invalid={errors.description ? true : undefined} className="md:col-span-2">
            <FieldLabel htmlFor="book-description">Description</FieldLabel>
            <Textarea
              id="book-description"
              rows={6}
              maxLength={BOOK_DESCRIPTION_MAX}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={
                errors.description ? "book-description-error" : "book-description-hint"
              }
              {...form.register("description")}
            />
            <p id="book-description-hint" className="text-sm text-muted-foreground">
              50 to 3,000 characters ({description.trim().length} so far).
            </p>
            <FieldError id="book-description-error" errors={[errors.description]} />
          </Field>
          <Field data-invalid={errors.language ? true : undefined}>
            <FieldLabel htmlFor="book-language">Language</FieldLabel>
            <Controller
              control={form.control}
              name="language"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                  <SelectTrigger id="book-language" className="w-full bg-card">
                    <SelectValue>
                      {BOOK_LANGUAGES.find((language) => language.code === field.value)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BOOK_LANGUAGES.map((language) => (
                      <SelectItem key={language.code} value={language.code}>
                        {language.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.language]} />
          </Field>
          <fieldset className="grid gap-2 md:col-span-2" aria-describedby="book-categories-hint">
            <legend className="mb-1 text-sm font-medium">Categories</legend>
            <p id="book-categories-hint" className="text-sm text-muted-foreground">
              Choose 1 to {BOOK_CATEGORIES_MAX}.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories.map((category) => {
                const checked = chosen.includes(category.slug);
                return (
                  <div key={category.slug} className="flex items-center gap-2">
                    <Checkbox
                      id={`category-${category.slug}`}
                      checked={checked}
                      disabled={!editable || (!checked && chosen.length >= BOOK_CATEGORIES_MAX)}
                      onCheckedChange={(next) =>
                        form.setValue(
                          "categories",
                          next === true
                            ? [...chosen, category.slug]
                            : chosen.filter((slug) => slug !== category.slug),
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }
                    />
                    <Label htmlFor={`category-${category.slug}`} className="font-normal">
                      {category.name}
                    </Label>
                  </div>
                );
              })}
            </div>
            {errors.categories ? (
              <p className="text-sm text-error" role="alert">
                {errors.categories.message ?? errors.categories.root?.message}
              </p>
            ) : null}
          </fieldset>
          <Field
            data-invalid={errors.licenseStatement ? true : undefined}
            className="md:col-span-2"
          >
            <FieldLabel htmlFor="book-license">License statement</FieldLabel>
            <Textarea
              id="book-license"
              rows={3}
              maxLength={1000}
              placeholder="For example: Published under CC BY 4.0 by the author, who holds the rights."
              aria-invalid={errors.licenseStatement ? true : undefined}
              aria-describedby={
                errors.licenseStatement ? "book-license-error" : "book-license-hint"
              }
              {...form.register("licenseStatement")}
            />
            <p id="book-license-hint" className="text-sm text-muted-foreground">
              Shown to readers on the book&apos;s page. 20 to 1,000 characters.
            </p>
            <FieldError id="book-license-error" errors={[errors.licenseStatement]} />
          </Field>
        </fieldset>

        {editable ? (
          <>
            <div className="flex items-start gap-3">
              <Checkbox
                id="book-rights"
                checked={rights}
                onCheckedChange={(checked) => {
                  setRights(checked === true);
                  setRightsError(null);
                }}
                aria-invalid={rightsError ? true : undefined}
                aria-describedby={rightsError ? "book-rights-error" : undefined}
              />
              <Label htmlFor="book-rights" className="leading-normal font-normal">
                I hold the rights to share this book, or I&apos;m authorized to publish it.
              </Label>
            </div>
            {rightsError ? (
              <p id="book-rights-error" className="text-sm text-error" role="alert">
                {rightsError}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="submit" variant="outline" disabled={isSubmitting || submitting}>
                {isSubmitting ? <Spinner aria-hidden="true" /> : null}
                Save draft
              </Button>
              <Button
                type="button"
                disabled={isSubmitting || submitting}
                onClick={() => void submit()}
              >
                {submitting ? <Spinner aria-hidden="true" /> : <Send aria-hidden="true" />}
                Submit for review
              </Button>
            </div>
          </>
        ) : null}
      </form>
    </Panel>
  );
}

function TextField({
  form,
  name,
  label,
  maxLength,
  errors,
}: {
  form: ReturnType<typeof useForm<BookDraftInput>>;
  name: "title" | "author";
  label: string;
  maxLength: number;
  errors: ReturnType<typeof useForm<BookDraftInput>>["formState"]["errors"];
}) {
  const id = `book-${name}`;
  return (
    <Field data-invalid={errors[name] ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        maxLength={maxLength}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${id}-error` : undefined}
        {...form.register(name)}
      />
      <FieldError id={`${id}-error`} errors={[errors[name]]} />
    </Field>
  );
}

const REVISION_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Not approved",
};

function History({ book }: { book: BookEditorView }) {
  if (book.history.length === 0) return null;
  return (
    <Panel title="Revisions" description="Every submission is kept, with the moderator's feedback.">
      <ol className="divide-y px-5 pb-3">
        {book.history.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3 text-sm">
            <span className="font-medium">Revision {row.revisionNo}</span>
            <span className="text-muted-foreground">
              {REVISION_LABELS[row.status] ?? row.status}
            </span>
            <span className="text-muted-foreground">{formatDate(row.updatedAt)}</span>
            {row.reviewReason ? (
              <p className="w-full [overflow-wrap:anywhere] whitespace-pre-line text-muted-foreground">
                {row.reviewReason}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Manage({ book }: { book: BookEditorView }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [busy, setBusy] = useState(false);
  if (!book.can.unpublish && !book.can.delete) return null;

  async function unpublish() {
    if (preview) return;
    setBusy(true);
    const result = await unpublishBookAction(book.id).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      reportFailure(result, "We couldn't unpublish it. Please try again.");
      return;
    }
    toast.success("Unpublished. It's no longer in the library.");
    router.refresh();
  }

  async function remove() {
    if (preview) return;
    setBusy(true);
    const result = await deleteBookDraftAction(book.id).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      reportFailure(result, "We couldn't delete it. Please try again.");
      return;
    }
    toast.success("Draft deleted.");
    router.push("/dashboard/publishing");
  }

  return (
    <Panel title="Manage">
      <div className="flex flex-wrap gap-3 px-5 pb-5">
        {book.can.unpublish ? (
          <Confirm
            trigger={
              <Button variant="outline" disabled={busy}>
                Unpublish
              </Button>
            }
            title="Unpublish this book?"
            description="It leaves the library and readers can't open it. Saves stay in their libraries but the book won't show. Publishing it again needs a new review."
            confirm="Unpublish"
            onConfirm={() => void unpublish()}
          />
        ) : null}
        {book.can.delete ? (
          <Confirm
            trigger={
              <Button variant="outline" className="text-error" disabled={busy}>
                <Trash2 aria-hidden="true" />
                Delete draft
              </Button>
            }
            title="Delete this draft?"
            description="The draft, its PDF and cover are deleted. This can't be undone."
            confirm="Delete draft"
            onConfirm={() => void remove()}
          />
        ) : null}
      </div>
    </Panel>
  );
}

function Confirm({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
