"use client";

import {
  PROJECT_TEMPLATE_LABELS,
  type ProjectExportView,
  type ProjectRevisionView,
} from "@foliomind/contracts";
import { Download, History, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format";
import { deleteExportAction, restoreRevisionAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { Panel } from "../panel";
import { StatusChip } from "../status-chip";
import type { EditorHandle } from "./studio-editor";
import type { StudioControls } from "./use-studio";

const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const when = (iso: string) => `${dateFormat.format(new Date(iso))} UTC`;

/**
 * Saved revisions and finished exports (Section 6 steps 7–9). Each export is
 * of one exact revision; restoring a revision keeps the current text as another.
 */
export function StudioHistory({
  studio,
  busy,
  editor,
}: {
  studio: StudioControls;
  busy: boolean;
  editor: React.RefObject<EditorHandle | null>;
}) {
  const { state } = studio;
  if (state.revisions.length === 0 && state.exports.length === 0) return null;
  return (
    <Panel title="History" headingLevel="h2" contentClassName="space-y-4 pt-0">
      {state.exports.length > 0 ? (
        <section aria-label="Exports" className="space-y-1.5">
          <h3 className="text-sm font-medium">Exports</h3>
          <ul className="space-y-1.5">
            {state.exports.map((item) => (
              <ExportRow key={item.id} item={item} studio={studio} busy={busy} />
            ))}
          </ul>
        </section>
      ) : null}
      {state.revisions.length > 0 ? (
        <section aria-label="Revisions" className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <History aria-hidden="true" className="size-4" />
            Revisions
          </h3>
          <ul className="space-y-1.5">
            {state.revisions.map((revision, index) => (
              <RevisionRow
                key={revision.id}
                revision={revision}
                isLatest={index === 0}
                studio={studio}
                busy={busy}
                editor={editor}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </Panel>
  );
}

function RevisionRow({
  revision,
  isLatest,
  studio,
  busy,
  editor,
}: {
  revision: ProjectRevisionView;
  isLatest: boolean;
  studio: StudioControls;
  busy: boolean;
  editor: React.RefObject<EditorHandle | null>;
}) {
  const { state, refresh, counterRef, preview } = studio;
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  async function restore() {
    if (preview) return;
    setWorking(true);
    if (!(await editor.current?.flush())) {
      setWorking(false);
      toast.error("Save your changes first. We couldn't save them just now.");
      return;
    }
    const result = await restoreRevisionAction({
      projectId: state.id,
      revisionId: revision.id,
      baseCounter: counterRef.current,
    }).catch(() => null);
    setWorking(false);
    if (result?.ok) {
      editor.current?.replace(result.data.content, result.data.counter);
      toast.success(`Revision ${revision.revisionNo} restored.`);
      await refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error("We couldn't restore that revision. Please try again.");
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">Revision {revision.revisionNo}</p>
        <p className="text-xs text-muted-foreground">{when(revision.createdAt)}</p>
      </div>
      {isLatest ? null : (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || working || state.archived}
          onClick={() => setConfirming(true)}
        >
          {working ? <Spinner aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          Restore
        </Button>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore revision {revision.revisionNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              It replaces the text in the editor. Your current text is saved as a new revision
              first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function ExportRow({
  item,
  studio,
  busy,
}: {
  item: ProjectExportView;
  studio: StudioControls;
  busy: boolean;
}) {
  const { state, refresh, requestExport, preview } = studio;
  const [working, setWorking] = useState(false);
  const details = [
    PROJECT_TEMPLATE_LABELS[item.template],
    `Revision ${item.revisionNo}`,
    ...(item.pageCount ? [`${item.pageCount} ${item.pageCount === 1 ? "page" : "pages"}`] : []),
    ...(item.bytes ? [formatBytes(item.bytes)] : []),
  ].join(" · ");

  async function remove() {
    if (preview) return;
    setWorking(true);
    const result = await deleteExportAction(item.id).catch(() => null);
    setWorking(false);
    if (result?.ok) {
      await refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error("We couldn't delete that export. Please try again.");
  }

  async function retry() {
    setWorking(true);
    await requestExport(item.revisionId);
    setWorking(false);
  }

  return (
    <li className="space-y-2 rounded-lg border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm">{details}</p>
        {item.status === "ready" ? (
          <StatusChip status="ready" />
        ) : item.status === "failed" ? (
          <StatusChip status="failed" label="Export failed" />
        ) : (
          <StatusChip status="processing" label="Rendering" />
        )}
      </div>
      {item.errorMessage ? <p className="text-sm text-error">{item.errorMessage}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {item.status === "ready" ? (
          <Button asChild size="sm" variant="outline">
            <a href={`/api/projects/${state.id}/exports/${item.id}/download`} download>
              <Download aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : null}
        {item.status === "failed" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={working || busy}
            onClick={() => void retry()}
          >
            {working ? <Spinner aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            Try again
          </Button>
        ) : null}
        {item.status === "ready" || item.status === "failed" ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete export of revision ${item.revisionNo}`}
            disabled={working}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
