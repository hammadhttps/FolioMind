"use client";

import { Bell, BellOff, UserCheck, UserPlus } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setFollowAction } from "@/lib/catalog/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { SignInDialog } from "../sign-in-dialog";

interface FollowValue {
  following: boolean;
  notify: boolean;
}

/**
 * Follow publisher (Section 20 shared interactions): optimistic with rollback.
 * Once following, a menu offers the notify switch (Section 11 "Follow") and
 * Unfollow. Guests sign in first.
 */
export function FollowButton({
  publisherId,
  name,
  initial,
  signedIn,
  returnTo,
}: {
  publisherId: string;
  name: string;
  initial: FollowValue;
  signedIn: boolean;
  returnTo: string;
}) {
  const [committed, setCommitted] = useState(initial);
  const [value, setValue] = useOptimistic(committed);
  const [pending, startTransition] = useTransition();

  function change(next: FollowValue, message: string) {
    startTransition(async () => {
      setValue(next);
      const result = await setFollowAction({ publisherId, ...next }).catch(() => null);
      if (!result?.ok) {
        if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
        else toast.error(result?.formError ?? "We couldn't update that. Please try again.");
        return;
      }
      setCommitted(result.data);
      toast.success(message);
    });
  }

  if (!signedIn) {
    return (
      <SignInDialog returnTo={returnTo}>
        <Button variant="outline">
          <UserPlus aria-hidden="true" />
          Follow publisher
        </Button>
      </SignInDialog>
    );
  }

  if (!value.following) {
    return (
      <Button
        variant="outline"
        aria-pressed={false}
        disabled={pending}
        onClick={() => change({ following: true, notify: true }, `You're following ${name}.`)}
      >
        <UserPlus aria-hidden="true" />
        Follow publisher
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-pressed={true} disabled={pending}>
          <UserCheck aria-hidden="true" />
          Following
          {value.notify ? (
            <Bell className="text-muted-foreground" aria-label="Notices on" />
          ) : (
            <BellOff className="text-muted-foreground" aria-label="Notices off" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuCheckboxItem
          checked={value.notify}
          onCheckedChange={(checked) =>
            change(
              { following: true, notify: checked === true },
              checked ? "You'll hear about new books." : "Notices turned off.",
            )
          }
        >
          Notify me about new books
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => change({ following: false, notify: false }, `You unfollowed ${name}.`)}
        >
          Unfollow
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
