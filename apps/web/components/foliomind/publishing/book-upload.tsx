"use client";

import {
  BOOK_UPLOAD_REFUSALS,
  COVER_IMAGE_TYPES,
  MAX_COVER_BYTES,
  MAX_SOURCE_PDF_BYTES,
  type BookUploadRefusalCode,
} from "@foliomind/contracts";
import { FileText, FileUp, ImageUp, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { useUploadThing } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";
import { ProgressBar } from "../progress-bar";

export type BookFileKind = "source" | "cover";

const ROUTE = { source: "bookSourcePdf", cover: "coverImage" } as const;

/** Client pre-check for feedback only; the route middleware and completion decide (Section 25). */
export function checkBookFile(kind: BookFileKind, file: File): BookUploadRefusalCode | null {
  if (kind === "source") {
    const pdf = file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
    if (!pdf) return "not_pdf";
    return file.size > MAX_SOURCE_PDF_BYTES ? "file_too_large" : null;
  }
  return (COVER_IMAGE_TYPES as readonly string[]).includes(file.type) &&
    file.size <= MAX_COVER_BYTES
    ? null
    : "not_image";
}

export function uploadErrorMessage(cause: unknown): string {
  const data = (cause as { data?: { message?: unknown } } | null)?.data;
  if (typeof data?.message === "string") return data.message;
  if (cause instanceof Error && cause.message && !/fetch|network/i.test(cause.message)) {
    return cause.message;
  }
  return "Something went wrong while saving it. Please try again.";
}

/**
 * Uploads a book's PDF or cover through FolioMind's UploadThing routes and
 * reports the server's answer: the completion callback alone creates records.
 */
export function useBookUpload(kind: BookFileKind) {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { startUpload, isUploading } = useUploadThing(ROUTE[kind], {
    onUploadProgress: setProgress,
    onUploadError: (cause) => setError(uploadErrorMessage(cause)),
  });

  async function upload(file: File, input: { bookId: string; title?: string | undefined }) {
    setError(null);
    setProgress(0);
    const problem = checkBookFile(kind, file);
    if (problem) {
      setError(BOOK_UPLOAD_REFUSALS[problem]);
      return false;
    }
    const result = await startUpload([file], input).catch((cause: unknown) => {
      setError(uploadErrorMessage(cause));
      return null;
    });
    if (!result) return false;
    const data = result[0]?.serverData as
      { revisionId: string | null; error: string | null } | undefined;
    if (!data?.revisionId) {
      const code = (data?.error ?? "upload_expired") as BookUploadRefusalCode;
      setError(BOOK_UPLOAD_REFUSALS[code] ?? BOOK_UPLOAD_REFUSALS.upload_expired);
      return false;
    }
    return true;
  }

  return { upload, isUploading, progress, error, setError };
}

/** A dashed drop target in FolioMind's own style (Section 25: no stock UploadThing UI). */
export function FileDrop({
  kind,
  file,
  onFile,
  busy,
  progress,
  compact = false,
}: {
  kind: BookFileKind;
  file: File | null;
  onFile: (file: File | null, problem: BookUploadRefusalCode | null) => void;
  busy: boolean;
  progress: number;
  compact?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const Icon = kind === "source" ? FileUp : ImageUp;

  function choose(next: File | undefined) {
    if (!next) {
      onFile(null, null);
      return;
    }
    onFile(next, checkBookFile(kind, next));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 1) {
      onFile(null, "one_file");
      return;
    }
    choose(event.dataTransfer.files[0]);
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-input/60 bg-muted/50 px-5 text-center transition-colors",
          compact ? "py-4" : "py-6",
          dragging && "border-primary bg-primary-subtle",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary-subtle text-primary-subtle-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {file ? (
          <div className="flex max-w-full items-center gap-2">
            <FileText className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate font-medium">{file.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground">{formatBytes(file.size)}</span>
            {busy ? null : (
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
          <p className="font-medium">
            {kind === "source"
              ? "Drop the book's PDF here or choose a file"
              : "Drop a cover image or choose one"}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {kind === "source"
            ? "PDF up to 20 MB · text-based PDFs work best"
            : "JPEG, PNG or WebP up to 4 MB"}
        </p>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={kind === "source" ? "application/pdf,.pdf" : COVER_IMAGE_TYPES.join(",")}
          className="sr-only"
          aria-label={kind === "source" ? "Choose the book's PDF" : "Choose a cover image"}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {kind === "source" ? "Choose a PDF" : "Choose an image"}
        </Button>
      </div>
      {busy ? <ProgressBar value={progress} label="Uploading" valueLabel={`${progress}%`} /> : null}
    </div>
  );
}
