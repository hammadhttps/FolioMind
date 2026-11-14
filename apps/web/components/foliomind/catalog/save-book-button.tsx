"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setBookSavedAction } from "@/lib/catalog/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { SignInDialog } from "../sign-in-dialog";

/**
 * Save to library (Section 20 shared interactions): the label and pressed
 * state change at once and roll back if the server refuses. Guests are asked
 * to sign in first and come back to the same page.
 */
export function SaveBookButton({
  bookId,
  title,
  saved,
  signedIn,
  returnTo,
  variant = "full",
  onChange,
}: {
  bookId: string;
  title: string;
  saved: boolean;
  signedIn: boolean;
  returnTo: string;
  /** `icon` sits on a cover in a grid. */
  variant?: "full" | "icon";
  onChange?: (saved: boolean) => void;
}) {
  const [committed, setCommitted] = useState(saved);
  const [optimistic, setOptimistic] = useOptimistic(committed);
  const [pending, startTransition] = useTransition();
  const Icon = optimistic ? BookmarkCheck : Bookmark;
  const label = optimistic ? "Saved to library" : "Save to library";

  const button =
    variant === "icon" ? (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="bg-card/90 shadow-card backdrop-blur"
        aria-pressed={signedIn ? optimistic : undefined}
        aria-label={signedIn ? `${optimistic ? "Remove" : "Save"} “${title}”` : `Save “${title}”`}
        disabled={pending}
        onClick={signedIn ? toggle : undefined}
      >
        <Icon aria-hidden="true" />
      </Button>
    ) : (
      <Button
        type="button"
        size="lg"
        variant="outline"
        aria-pressed={signedIn ? optimistic : undefined}
        disabled={pending}
        onClick={signedIn ? toggle : undefined}
      >
        <Icon aria-hidden="true" />
        {label}
      </Button>
    );

  function toggle() {
    const next = !optimistic;
    startTransition(async () => {
      setOptimistic(next);
      const result = await setBookSavedAction({ bookId, saved: next }).catch(() => null);
      if (!result?.ok) {
        if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
        else toast.error(result?.formError ?? "We couldn't update your library. Please try again.");
        return;
      }
      setCommitted(result.data.saved);
      onChange?.(result.data.saved);
      toast.success(result.data.saved ? "Saved to your library." : "Removed from your library.");
    });
  }

  if (!signedIn) return <SignInDialog returnTo={returnTo}>{button}</SignInDialog>;
  return button;
}
