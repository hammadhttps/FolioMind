"use client";

import {
  isTerminalJobStatus,
  PROJECT_REFUSALS,
  studioStateSchema,
  type ProjectGenerateRequest,
  type StudioState,
} from "@foliomind/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { handleRateLimitResponse } from "@/lib/rate-limit-toast";
import { useIsPreview } from "../session-user";

/*
 * PDF Studio's server state: the first render, then `GET /api/projects/:id` every
 * 3 seconds while a job runs. It sends the counter it already holds, so the
 * document only travels when it has changed.
 */

const POLL_MS = 3000;

export const studioQueryKey = (projectId: string) => ["studio", projectId] as const;

export const isLiveJob = (job: StudioState["job"]): boolean =>
  job !== null && !isTerminalJobStatus(job.status);

async function fetchState(projectId: string, counter: number): Promise<StudioState> {
  const response = await fetch(`/api/projects/${projectId}?counter=${counter}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`studio state ${response.status}`);
  return studioStateSchema.parse(await response.json());
}

/** Posts to a Studio route and shows anything that went wrong. Returns the body, or null. */
async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) {
    toast.error("We couldn't reach FolioMind. Check your connection.");
    return null;
  }
  if (handleRateLimitResponse(response)) return null;
  const json = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (response.ok) return json;
  const code = json?.error?.code as keyof typeof PROJECT_REFUSALS | undefined;
  toast.error(json?.error?.message ?? (code && PROJECT_REFUSALS[code]) ?? "That didn't work.");
  return null;
}

export function useStudio(initial: StudioState) {
  const preview = useIsPreview();
  const queryClient = useQueryClient();
  /** The document version the editor holds; the editor keeps this up to date. */
  const counterRef = useRef(initial.revisionCounter);

  const query = useQuery({
    queryKey: studioQueryKey(initial.id),
    initialData: initial,
    queryFn: () => fetchState(initial.id, counterRef.current),
    enabled: !preview,
    refetchInterval: (current) => (isLiveJob(current.state.data?.job ?? null) ? POLL_MS : false),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const state = query.data;

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: studioQueryKey(initial.id) }),
    [initial.id, queryClient],
  );

  const generate = useCallback(
    async (request: ProjectGenerateRequest): Promise<boolean> => {
      if (preview) return false;
      const result = await postJson<{ jobId: string }>(
        `/api/projects/${initial.id}/generate`,
        request,
      );
      if (!result) return false;
      await refresh();
      return true;
    },
    [initial.id, preview, refresh],
  );

  const requestExport = useCallback(
    async (revisionId: string): Promise<{ reused: boolean; exportId: string } | null> => {
      if (preview) return null;
      const result = await postJson<{ exportId: string; reused?: boolean }>(
        `/api/projects/${initial.id}/exports`,
        { revisionId },
      );
      if (!result) return null;
      await refresh();
      return { reused: result.reused === true, exportId: result.exportId };
    },
    [initial.id, preview, refresh],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(
        () => null,
      );
      if (response && handleRateLimitResponse(response)) return;
      if (!response?.ok) toast.error("We couldn't stop that. It may already have finished.");
      await refresh();
    },
    [refresh],
  );

  // Says when a job the page was watching ends, whether or not the person is looking at it.
  const watched = useRef<string | null>(isLiveJob(initial.job) ? (initial.job?.id ?? null) : null);
  const job = state.job;
  useEffect(() => {
    if (!job) return;
    if (isLiveJob(job)) {
      watched.current = job.id;
      return;
    }
    if (watched.current !== job.id) return;
    watched.current = null;
    if (job.status === "succeeded") {
      if (job.kind === "generate-outline") toast.success("Your outline is ready to review.");
      if (job.kind === "generate-draft") toast.success("Your draft is ready to edit.");
      if (job.kind === "regenerate-section") toast.success("A new version is ready to compare.");
      if (job.kind === "render-export") toast.success("Your PDF is ready.");
    }
  }, [job]);

  return { state, preview, refresh, generate, requestExport, cancelJob, counterRef };
}

export type StudioControls = ReturnType<typeof useStudio>;
