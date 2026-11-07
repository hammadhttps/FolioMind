"use client";

import { PROJECT_TEMPLATE_LABELS, type StudioState } from "@foliomind/contracts";
import { Eye, FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SavedRevision } from "@/lib/projects/actions";
import { AppDialog } from "../app-dialog";
import { StatusAlert } from "../status-alert";
import { AllowanceNote } from "./allowance-note";
import type { EditorHandle } from "./studio-editor";
import type { StudioControls } from "./use-studio";

/**
 * Preview (Phase 8 skill): the export's own HTML in a sandboxed frame with no
 * scripts. The white page stays white in dark mode, because that's what prints.
 */
export function StudioPreview({
  state,
  editor,
  disabled,
}: {
  state: StudioState;
  editor: React.RefObject<EditorHandle | null>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(false);

  async function show() {
    setLoading(true);
    await editor.current?.flush();
    setLoading(false);
    setLoadedAt(Date.now());
    setOpen(true);
  }

  return (
    <>
      <Button variant="outline" disabled={disabled || loading} onClick={() => void show()}>
        {loading ? <Spinner aria-hidden="true" /> : <Eye aria-hidden="true" />}
        Preview
      </Button>
      <AppDialog
        open={open}
        onOpenChange={setOpen}
        title="Preview"
        description={`How ${PROJECT_TEMPLATE_LABELS[state.template]} lays out your saved text. Page breaks and numbers appear in the PDF.`}
        className="sm:max-w-[860px]"
      >
        {open ? (
          <iframe
            key={loadedAt}
            title="Document preview"
            sandbox=""
            src={`/api/projects/${state.id}/preview?at=${loadedAt}`}
            className="h-[70vh] w-full rounded-lg border bg-white"
          />
        ) : null}
      </AppDialog>
    </>
  );
}

/**
 * Export PDF (Section 6 steps 7–9): saves a revision if the text changed, says
 * exactly what will be exported and what it costs, and only then queues it.
 */
export function StudioExport({
  studio,
  editor,
  disabled,
}: {
  studio: StudioControls;
  editor: React.RefObject<EditorHandle | null>;
  disabled: boolean;
}) {
  const { state, requestExport } = studio;
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [revision, setRevision] = useState<SavedRevision | null>(null);

  async function prepare() {
    setPreparing(true);
    const saved = (await editor.current?.saveRevision()) ?? null;
    setPreparing(false);
    if (!saved) return;
    setRevision(saved);
    setOpen(true);
  }

  async function start() {
    if (!revision) return;
    setExporting(true);
    const result = await requestExport(revision.revision.id);
    setExporting(false);
    if (!result) return;
    setOpen(false);
    toast.success(
      result.reused
        ? "This revision is already exported. It's in your history."
        : "Exporting your PDF. You can keep working.",
    );
  }

  return (
    <>
      <Button disabled={disabled || preparing} onClick={() => void prepare()}>
        {preparing ? <Spinner aria-hidden="true" /> : <FileDown aria-hidden="true" />}
        Export PDF
      </Button>
      <AppDialog
        open={open}
        onOpenChange={setOpen}
        title="Export PDF"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={exporting} onClick={() => void start()}>
              {exporting ? <Spinner aria-hidden="true" /> : <FileDown aria-hidden="true" />}
              Export
            </Button>
          </>
        }
      >
        {revision ? (
          <div className="space-y-3">
            <p className="text-[0.9375rem]">
              Revision {revision.revision.revisionNo} as {PROJECT_TEMPLATE_LABELS[state.template]},{" "}
              {state.settings.pageSize}.
            </p>
            <AllowanceNote
              charge={revision.exportCharge === "reexport" ? "reexport" : "none"}
              allowance={state.allowance}
            />
            {state.mode === "general" ? (
              <StatusAlert tone="warning">
                The PDF is labelled “AI generated, not grounded in your sources” and has no
                citations.
              </StatusAlert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Exporting doesn&apos;t publish anything. The PDF stays private to you.
            </p>
          </div>
        ) : null}
      </AppDialog>
    </>
  );
}
