"use client";

import { BOOK_UPLOAD_REFUSALS } from "@foliomind/contracts";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createBookAction } from "@/lib/publishing/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";
import { FileDrop, useBookUpload } from "./book-upload";

/**
 * Submit a publication (Section 20 #12): a title and the book's PDF start a
 * draft. Metadata, cover and the submission itself follow in the book editor,
 * once the PDF has been processed.
 */
export function AddBookDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AppDialog
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      title="Submit a publication"
      description="Start with the title and the PDF you're authorized to share. You'll add details next."
    >
      {open ? <AddBookForm onCancel={() => setOpen(false)} /> : null}
    </AppDialog>
  );
}

function AddBookForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { upload, isUploading, progress, error, setError } = useBookUpload("source");
  const busy = creating || isUploading;

  async function submit() {
    setFormError(null);
    if (!title.trim()) {
      setFormError("Enter a title.");
      return;
    }
    if (!file) {
      setFormError("Choose the book's PDF.");
      return;
    }
    if (preview) return;
    setCreating(true);
    const created = await createBookAction().catch(() => null);
    setCreating(false);
    if (!created?.ok) {
      if (created?.code === "rate_limited") showRateLimitToast(created.retryAfterSeconds);
      else setFormError(created?.formError ?? "We couldn't start that book. Please try again.");
      return;
    }
    const bookId = created.data.bookId;
    const uploaded = await upload(file, { bookId, title: title.trim() });
    // The draft exists either way; its editor lets the publisher try the PDF again.
    if (uploaded) toast.success("PDF added. It's being processed; add the details meanwhile.");
    else toast.error("The draft was saved, but the PDF didn't upload. Try it again in the editor.");
    router.push(`/dashboard/publishing?book=${bookId}`);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {formError || error ? (
        <StatusAlert tone="error" title="We couldn't add that book.">
          {formError ?? error}
        </StatusAlert>
      ) : null}
      <Field>
        <FieldLabel htmlFor="new-book-title">Title</FieldLabel>
        <Input
          id="new-book-title"
          value={title}
          maxLength={200}
          autoFocus
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <FileDrop
        kind="source"
        file={file}
        busy={isUploading}
        progress={progress}
        onFile={(next, problem) => {
          setError(problem ? BOOK_UPLOAD_REFUSALS[problem] : null);
          setFile(problem ? null : next);
        }}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner aria-hidden="true" /> : null}
          Add book
        </Button>
      </div>
    </form>
  );
}
