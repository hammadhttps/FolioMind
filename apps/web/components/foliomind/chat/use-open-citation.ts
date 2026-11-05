"use client";

import { sourceOpenResponseSchema } from "@foliomind/contracts";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { handleRateLimitResponse } from "@/lib/rate-limit-toast";

export interface CitationTarget {
  versionId: string | null;
  pageStart: number;
}

const REMOVED = "This source is no longer available.";

/**
 * Opens a citation after checking access again (Section 8 step 8): the current
 * document jumps to the page, anything else opens in the Reader. A removed
 * source explains itself, and a replaced version is never swapped in silently.
 */
export function useOpenCitation({
  currentDocumentId,
  goToPage,
}: {
  currentDocumentId?: string;
  goToPage?: (page: number) => void;
} = {}) {
  const router = useRouter();
  return useCallback(
    async (citation: CitationTarget) => {
      if (!citation.versionId) {
        toast.error(REMOVED);
        return;
      }
      const response = await fetch(
        `/api/sources/${citation.versionId}/open?page=${citation.pageStart}`,
        { cache: "no-store" },
      ).catch(() => null);
      if (response && handleRateLimitResponse(response)) return;
      const parsed = response?.ok
        ? sourceOpenResponseSchema.safeParse(await response.json().catch(() => null))
        : null;
      if (!parsed?.success) {
        toast.error("We couldn't open that source. Please try again.");
        return;
      }
      const result = parsed.data;
      if (!result.available) {
        if (result.reason === "superseded" && result.documentId) {
          const { documentId } = result;
          toast.error("This citation points to an earlier version of the document.", {
            action: {
              label: "Open current version",
              onClick: () => router.push(`/read/${documentId}`),
            },
          });
          return;
        }
        toast.error(REMOVED);
        return;
      }
      if (result.documentId === currentDocumentId && goToPage) goToPage(result.page);
      else router.push(`/read/${result.documentId}?page=${result.page}`);
    },
    [currentDocumentId, goToPage, router],
  );
}
