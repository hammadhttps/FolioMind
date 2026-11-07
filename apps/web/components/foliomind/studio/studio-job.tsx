"use client";

import { JOB_PHASE_LABELS, type StudioState } from "@foliomind/contracts";
import { Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ProgressBar } from "../progress-bar";
import { StatusAlert } from "../status-alert";
import { isLiveJob, type StudioControls } from "./use-studio";

const LIVE_TITLES: Record<NonNullable<StudioState["job"]>["kind"], string> = {
  "ingest-document": "",
  "import-url": "",
  "generate-outline": "Generating your outline",
  "generate-draft": "Drafting your document",
  "regenerate-section": "Rewriting a section",
  "render-export": "Exporting your PDF",
};

const FAILED_TITLES: Record<NonNullable<StudioState["job"]>["kind"], string> = {
  "ingest-document": "",
  "import-url": "",
  "generate-outline": "We couldn't generate an outline.",
  "generate-draft": "We couldn't finish your draft.",
  "regenerate-section": "We couldn't rewrite that section.",
  "render-export": "Export failed.",
};

/**
 * Job progress and failure recovery (Section 21 "Studio"). A draft's finished
 * sections stay when it fails or is stopped, and trying again fills in the rest
 * without charging twice.
 */
export function StudioJob({ studio }: { studio: StudioControls }) {
  const { state, generate, cancelJob } = studio;
  const job = state.job;
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  if (!job) return null;

  async function retryOutline() {
    setRetrying(true);
    await generate({ kind: "outline" });
    setRetrying(false);
  }
  async function retryDraft() {
    setRetrying(true);
    await generate({ kind: "draft", replace: state.firstDraftDone });
    setRetrying(false);
  }

  if (isLiveJob(job)) {
    const { sections, sectionsDone } = job.progress;
    const stepping = job.kind === "generate-draft" && Boolean(sections);
    return (
      <div className="space-y-2 rounded-xl border bg-card px-4 py-3.5" role="status">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 font-medium">
            <Spinner aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0">{LIVE_TITLES[job.kind]}</span>
          </p>
          {job.canCancel ? (
            <Button
              size="sm"
              variant="outline"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                void cancelJob(job.id).finally(() => setStopping(false));
              }}
            >
              {stopping ? <Spinner aria-hidden="true" /> : <Square aria-hidden="true" />}
              Stop
            </Button>
          ) : null}
        </div>
        {stepping ? (
          <ProgressBar
            value={((sectionsDone ?? 0) / (sections ?? 1)) * 100}
            label={JOB_PHASE_LABELS[job.phase]}
            valueLabel={`${sectionsDone ?? 0} of ${sections} sections`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{JOB_PHASE_LABELS[job.phase]}</p>
        )}
        <p className="text-sm text-muted-foreground">You can leave this page. It keeps going.</p>
      </div>
    );
  }

  if (job.status === "cancelled" && job.kind === "generate-draft" && !state.firstDraftDone) {
    return (
      <StatusAlert
        tone="info"
        title="Drafting stopped."
        action={<RetryButton retrying={retrying} onRetry={retryDraft} label="Continue" />}
      >
        The sections already written are kept, and you can edit them.
      </StatusAlert>
    );
  }

  if (job.status !== "failed") return null;

  const retry =
    job.kind === "generate-outline"
      ? retryOutline
      : job.kind === "generate-draft"
        ? retryDraft
        : null;

  return (
    <StatusAlert
      tone="error"
      title={FAILED_TITLES[job.kind]}
      action={job.canRetry && retry ? <RetryButton retrying={retrying} onRetry={retry} /> : null}
    >
      {job.errorMessage}
    </StatusAlert>
  );
}

function RetryButton({
  retrying,
  onRetry,
  label = "Try again",
}: {
  retrying: boolean;
  onRetry: () => Promise<void>;
  label?: string;
}) {
  return (
    <Button size="sm" variant="outline" disabled={retrying} onClick={() => void onRetry()}>
      {retrying ? <Spinner aria-hidden="true" /> : null}
      {label}
    </Button>
  );
}
