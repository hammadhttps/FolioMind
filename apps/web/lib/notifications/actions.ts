"use server";

import {
  NOTIFICATION_PAGE_SIZE,
  notificationPreferencesSchema,
  type ActionResult,
  type NotificationPreferences,
} from "@foliomind/contracts";
import {
  dismissNotification,
  listNotifications,
  markNotificationsRead,
  setNotificationPreferences,
  unreadNotificationCount,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { toNotificationView, type NotificationView } from "./view";

/*
 * Notification bell and preferences (blueprint Sections 7, 11 and 28). Only the
 * recipient reads or changes their notifications.
 */

export async function loadNotificationsAction(
  cursor?: string,
): Promise<ActionResult<{ items: NotificationView[]; nextCursor: string | null; unread: number }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedRead", await headers());
  if (limited) return limited;
  const safeCursor = z.string().max(400).optional().catch(undefined).parse(cursor);
  const [page, unread] = await Promise.all([
    listNotifications(getDb(), user.id, { cursor: safeCursor, limit: NOTIFICATION_PAGE_SIZE }),
    unreadNotificationCount(getDb(), user.id),
  ]);
  return {
    ok: true,
    data: { items: page.items.map(toNotificationView), nextCursor: page.nextCursor, unread },
  };
}

export async function unreadCountAction(): Promise<ActionResult<{ unread: number }>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedRead", await headers());
  if (limited) return limited;
  return { ok: true, data: { unread: await unreadNotificationCount(getDb(), user.id) } };
}

/** Marks the given notifications read, or all of them when no IDs are given. */
export async function markNotificationsReadAction(ids?: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = z.array(z.uuid()).max(100).optional().safeParse(ids);
  if (!parsed.success) return { ok: false, code: "invalid", formError: "We couldn't update that." };
  await markNotificationsRead(getDb(), user.id, parsed.data);
  return { ok: true, data: undefined };
}

export async function dismissNotificationAction(id: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success || !(await dismissNotification(getDb(), user.id, parsed.data))) {
    return { ok: false, code: "not_found", formError: "That notification is already gone." };
  }
  return { ok: true, data: undefined };
}

export async function updateNotificationPreferencesAction(
  input: NotificationPreferences,
): Promise<ActionResult<NotificationPreferences>> {
  const user = await requireUser();
  const limited = await rateLimitAction("authenticatedMutation", await headers());
  if (limited) return limited;
  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", formError: "We couldn't save that." };
  await setNotificationPreferences(getDb(), user.id, parsed.data);
  return { ok: true, data: parsed.data };
}
