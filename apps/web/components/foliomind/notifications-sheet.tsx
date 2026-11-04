"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  dismissNotificationAction,
  loadNotificationsAction,
  markNotificationsReadAction,
  unreadCountAction,
} from "@/lib/notifications/actions";
import type { NotificationView } from "@/lib/notifications/view";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { useIsPreview } from "./session-user";

const UNREAD_KEY = ["notifications", "unread"] as const;
const LIST_KEY = ["notifications", "list"] as const;

async function unwrap<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; formError?: string }>,
) {
  const result = await promise;
  if (!result.ok) throw new Error(result.formError ?? "Something went wrong.");
  return result.data;
}

/**
 * The notification bell (Sections 7 and 20): an unread dot, then the history
 * newest first with "Load more", read state, mark all read and dismiss. The
 * unread count refreshes every minute and when the window regains focus.
 */
export function NotificationsSheet() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  // The dev gallery previews the shell without a session: nothing to load.
  const preview = useIsPreview();

  const unread = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: () => unwrap(unreadCountAction()),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled: !preview,
  });
  const list = useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam }) => unwrap(loadNotificationsAction(pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open && !preview,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => unwrap(markNotificationsReadAction(ids)),
    onSettled: refresh,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => unwrap(dismissNotificationAction(id)),
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  });

  const count = unread.data?.unread ?? 0;
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refresh();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
            >
              <Bell className="size-5" aria-hidden="true" />
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-background bg-primary"
                />
              ) : null}
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="space-y-1">
              <SheetTitle className="text-base">Notifications</SheetTitle>
              <SheetDescription>
                Updates about your documents, research and projects.
              </SheetDescription>
            </div>
          </div>
          {count > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 w-fit"
              onClick={() => markRead.mutate(undefined)}
              disabled={markRead.isPending}
            >
              <CheckCheck aria-hidden="true" />
              Mark all as read
            </Button>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {!preview && list.isPending ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Spinner aria-hidden="true" />
              Loading notifications…
            </div>
          ) : !preview && list.isError ? (
            <div className="space-y-3 p-5 text-sm">
              <p>We couldn&apos;t load your notifications.</p>
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full items-center p-5">
              <EmptyState
                variant="plain"
                icon={Bell}
                title="You're all caught up."
                description="When a document finishes processing or a project is ready, you'll see it here."
              />
            </div>
          ) : (
            <ul aria-label="Notifications" className="divide-y">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    if (!item.read) markRead.mutate([item.id]);
                    setOpen(false);
                  }}
                  onDismiss={() => dismiss.mutate(item.id)}
                />
              ))}
            </ul>
          )}
          {list.hasNextPage ? (
            <div className="p-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NotificationRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: NotificationView;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className={cn("relative flex gap-3 px-5 py-4", !item.read && "bg-primary-subtle/50")}>
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          item.read ? "bg-transparent" : "bg-primary",
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={item.targetPath}
          onClick={onOpen}
          className="block text-sm font-semibold text-foreground after:absolute after:inset-0 focus-visible:underline focus-visible:outline-none"
        >
          {item.title}
          {item.read ? null : <span className="sr-only"> (unread)</span>}
        </Link>
        <p className="text-sm text-muted-foreground">{item.body}</p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={item.createdAt}>
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          </time>
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="relative z-10 -mt-1 -mr-2 size-8 shrink-0"
        aria-label={`Dismiss: ${item.title}`}
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}
