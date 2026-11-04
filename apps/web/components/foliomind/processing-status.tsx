"use client";

import {
  isTerminalJobStatus,
  jobStatusResponseSchema,
  type JobStatusResponse,
} from "@foliomind/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { LibraryCard } from "@/lib/library/view";
import { handleRateLimitResponse } from "@/lib/rate-limit-toast";
import { useIsPreview } from "./session-user";
import { StatusChip } from "./status-chip";

/*
 * Processing state on a library card (blueprint Section 9 and the Phase 6 job
 * status UI): while a job runs, the card polls `GET /api/jobs/:id` and shows
 * the current phase; it stops polling once the job ends and refreshes the
 * page. Failures show the safe reason with Retry when a retry can help.
 */

export const jobQueryKey = (jobId: string) => ["job", jobId] as const;

export async function fetchJob(jobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`job status ${response.status}`);
  return jobStatusResponseSchema.parse(await response.json());
}

async function post(url: string): Promise<{ ok: boolean; message?: string }> {
  const response = await fetch(url, { method: "POST" }).catch(() => null);
  if (!response)
    return { ok: false, message: "We couldn't reach FolioMind. Check your connection." };
  if (handleRateLimitResponse(response)) return { ok: false };
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return { ok: false, message: body?.error?.message ?? "That didn't work. Please try again." };
}

function progressText(job: JobStatusResponse): string {
  const { embedded, chunks, pages } = job.progress;
  if (job.phase === "embedding" && chunks) return `${job.phaseLabel} ${embedded ?? 0} of ${chunks}`;
  if (job.phase === "extracting" && pages) return `${job.phaseLabel} ${pages} pages`;
  return job.phaseLabel;
}

export function ProcessingStatus({
  item,
  onFinished,
}: {
  item: LibraryCard;
  onFinished: () => void;
}) {
  const preview = useIsPreview();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const liveJobId = item.job?.live ? item.job.id : null;

  const job = useQuery({
    queryKey: jobQueryKey(liveJobId ?? "none"),
    queryFn: () => fetchJob(liveJobId!),
    enabled: Boolean(liveJobId) && !preview,
    refetchInterval: (query) =>
      query.state.data && isTerminalJobStatus(query.state.data.status) ? false : 3000,
    refetchOnWindowFocus: true,
  });

  // When the polled job finishes, the server's view of the card changes.
  const finished = job.data ? isTerminalJobStatus(job.data.status) : false;
  const reported = useRef(false);
  useEffect(() => {
    if (finished && !reported.current) {
      reported.current = true;
      onFinished();
    }
  }, [finished, onFinished]);

  async function run(url: string, success: string) {
    if (preview) return;
    setBusy(true);
    const result = await post(url);
    setBusy(false);
    if (!result.ok) {
      if (result.message) toast.error(result.message);
      return;
    }
    toast.success(success);
    if (liveJobId) await queryClient.invalidateQueries({ queryKey: jobQueryKey(liveJobId) });
    onFinished();
  }

  const reimporting = item.status === "ready" && item.job?.live && item.job.kind === "import-url";

  if (item.status === "ready" && !reimporting) return <StatusChip status="ready" />;

  if (item.job?.live || item.status === "processing") {
    // The chip already says Processing; the line adds the phase once it is known.
    const label = reimporting ? "Re-importing…" : job.data ? progressText(job.data) : null;
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={reimporting ? "ready" : "processing"} />
          {liveJobId ? (
            <Button
              variant="ghost"
              size="xs"
              className="relative z-10 h-6 px-1.5 text-muted-foreground"
              disabled={busy}
              onClick={() => void run(`/api/jobs/${liveJobId}/cancel`, "Processing cancelled.")}
            >
              <X aria-hidden="true" />
              Cancel
            </Button>
          ) : null}
        </div>
        {label ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {label}
          </p>
        ) : null}
      </div>
    );
  }

  // Needs attention: the safe reason, and Retry when a retry can help.
  return (
    <div className="space-y-1.5">
      <StatusChip status="attention" />
      {item.job?.errorMessage ? (
        <p className="line-clamp-3 text-xs text-muted-foreground">{item.job.errorMessage}</p>
      ) : null}
      {item.job?.canRetry && item.documentId ? (
        <Button
          variant="outline"
          size="xs"
          className="relative z-10"
          disabled={busy}
          onClick={() => void run(`/api/documents/${item.documentId}/retry`, "Trying again.")}
        >
          <RotateCcw aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
