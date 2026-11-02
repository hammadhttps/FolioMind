"use client";

import {
  MAX_SOURCE_PDF_BYTES,
  UPLOAD_REFUSALS,
  type UploadRefusalCode,
} from "@foliomind/contracts";
import { FileText, FileUp, Globe, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/format";
import { useUploadThing } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";
import { AppDialog } from "./app-dialog";
import { ProgressBar } from "./progress-bar";
import { useIsPreview } from "./session-user";
import { StatusAlert } from "./status-alert";

export interface UploadAllowanceView {
  documents: number;
  documentLimit: number;
  storageBytes: number;
  storageLimitBytes: number;
}

/** Client checks are feedback only; the server repeats every check (Section 25). */
function checkFile(file: File): UploadRefusalCode | null {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "not_pdf";
  if (file.size > MAX_SOURCE_PDF_BYTES) return "file_too_large";
  return null;
}

/**
 * My Library's upload dialog (Sections 20 and 25): Upload PDF through
 * UploadThing, with the Import from URL tab opening in Phase 6. The success
 * toast appears only after the server has created the document.
 */
export function UploadDialog({
  trigger,
  allowance,
}: {
  trigger: ReactNode;
  allowance?: UploadAllowanceView | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AppDialog
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      title="Add to your library"
      description="Upload a PDF or import one web article. Both stay private to you."
    >
      <Tabs defaultValue="upload" className="gap-4">
        <TabsList className="w-full">
          <TabsTrigger value="upload" className="flex-1">
            <FileUp aria-hidden="true" />
            Upload PDF
          </TabsTrigger>
          <TabsTrigger value="url" className="flex-1">
            <Globe aria-hidden="true" />
            Import from URL
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <UploadForm allowance={allowance ?? null} onDone={() => setOpen(false)} />
        </TabsContent>

        <TabsContent value="url" className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="import-url">Article URL</Label>
            <Input
              id="import-url"
              type="url"
              inputMode="url"
              disabled
              placeholder="https://example.com/article"
            />
            <p className="text-sm text-muted-foreground">
              One public article at a time. Pages behind a sign-in can&apos;t be imported.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox id="import-rights" disabled className="mt-0.5" />
            <Label htmlFor="import-rights" className="leading-snug font-normal">
              I may save this page for personal study.
            </Label>
          </div>
          <div className="flex flex-col-reverse items-stretch gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-sm text-muted-foreground sm:mr-auto">Web import opens soon.</p>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button disabled>Import</Button>
          </div>
        </TabsContent>
      </Tabs>
    </AppDialog>
  );
}

function UploadForm({
  allowance,
  onDone,
}: {
  allowance: UploadAllowanceView | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  const { startUpload, isUploading } = useUploadThing("sourcePdf", {
    onUploadProgress: setProgress,
    // Refusals from the route middleware arrive here with the server's message.
    onUploadError: (cause) => setError(errorMessage(cause)),
  });

  function choose(next: File | undefined) {
    setError(null);
    setProgress(0);
    if (!next) return;
    const problem = checkFile(next);
    if (problem) {
      setFile(null);
      setError(UPLOAD_REFUSALS[problem]);
      return;
    }
    setFile(next);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 1) {
      setError(UPLOAD_REFUSALS.one_file);
      return;
    }
    choose(event.dataTransfer.files[0]);
  }

  async function upload() {
    if (!file || preview) return;
    setError(null);
    const result = await startUpload([file], { title: title.trim() || undefined }).catch(
      (cause: unknown) => {
        setError(errorMessage(cause));
        return null;
      },
    );
    // No result: onUploadError has already explained why.
    if (!result) return;
    const data = result[0]?.serverData;
    if (!data?.documentId) {
      setError(UPLOAD_REFUSALS[(data?.error as UploadRefusalCode | null) ?? "failed"]);
      return;
    }
    toast.success("Your PDF is ready to read.");
    setFile(null);
    setTitle("");
    setProgress(0);
    onDone();
    router.refresh();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void upload();
      }}
    >
      {error ? (
        <StatusAlert tone="error" title="We couldn't add that file.">
          {error}
        </StatusAlert>
      ) : null}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-input/60 bg-muted/50 px-6 py-7 text-center transition-colors",
          dragging && "border-primary bg-primary-subtle",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary-subtle text-primary-subtle-foreground">
          <FileUp className="size-6" aria-hidden="true" />
        </span>
        {file ? (
          <div className="flex max-w-full items-center gap-2">
            <FileText className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate font-medium">{file.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground">{formatBytes(file.size)}</span>
            {isUploading ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove this file"
                onClick={() => choose(undefined)}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        ) : (
          <p className="font-medium">Drop a PDF here or choose a file</p>
        )}
        <p className="text-sm text-muted-foreground">PDF up to 20 MB · text-based PDFs work best</p>
        <input
          ref={fileInput}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading}
          onClick={() => fileInput.current?.click()}
        >
          Choose a PDF
        </Button>
      </div>

      {isUploading ? (
        <ProgressBar value={progress} label="Uploading" valueLabel={`${progress}%`} />
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor={`${inputId}-title`}>Title (optional)</Label>
        <Input
          id={`${inputId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          disabled={isUploading}
          placeholder="Uses the file name if left empty"
        />
      </div>

      {allowance ? <AllowanceLine allowance={allowance} /> : null}

      <div className="flex flex-col-reverse items-stretch gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isUploading}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!file || isUploading}>
          {isUploading ? <Spinner aria-hidden="true" /> : null}
          {isUploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}

function AllowanceLine({ allowance }: { allowance: UploadAllowanceView }) {
  return (
    <p className="text-sm text-muted-foreground">
      You have used {formatBytes(allowance.storageBytes)} of{" "}
      {formatBytes(allowance.storageLimitBytes)} and {allowance.documents} of{" "}
      {allowance.documentLimit} PDFs.
    </p>
  );
}

function errorMessage(cause: unknown): string {
  const data = (cause as { data?: { message?: unknown } } | null)?.data;
  if (typeof data?.message === "string") return data.message;
  if (cause instanceof Error && cause.message && !/fetch|network/i.test(cause.message)) {
    return cause.message;
  }
  return UPLOAD_REFUSALS.failed;
}
