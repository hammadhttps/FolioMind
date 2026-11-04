import {
  NOTIFICATION_RETENTION_DAYS,
  preferenceFor,
  readNotificationPreferences,
  type NotificationType,
} from "@foliomind/contracts";
import { documents, notifications, userPreferences, type Executor } from "@foliomind/db";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { decodeCursor, encodeCursor } from "../library";

/*
 * In-app notifications (blueprint Sections 7, 11 and 24). FolioMind writes the
 * title and body from the notification type; only the document's own title
 * (the owner's metadata) appears in the body, never document text. Push was
 * dropped (user decision, 2026-11-04), so the bell is the only channel.
 */

interface Template {
  title: string;
  body: (subject: string) => string;
  path: (documentId: string) => string;
}

const ATTENTION_PATH = "/dashboard/library?status=attention";

const TEMPLATES: Record<NotificationType, Template> = {
  document_ready: {
    title: "Your PDF is ready to read.",
    body: (title) => `“${title}” is ready for reading and questions.`,
    path: (id) => `/read/${id}`,
  },
  document_failed: {
    title: "We couldn't process your PDF.",
    body: (title) => `“${title}” couldn't be processed. Open My Library to see why or try again.`,
    path: () => ATTENTION_PATH,
  },
  document_needs_ocr: {
    title: "This PDF has no readable text.",
    body: (title) =>
      `“${title}” looks scanned, so it can't be searched or used for answers. You can still read it.`,
    path: () => ATTENTION_PATH,
  },
  import_failed: {
    title: "We couldn't import that article.",
    body: (title) => `“${title}” couldn't be imported. Open My Library to see why or try again.`,
    path: () => ATTENTION_PATH,
  },
};

const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/**
 * Writes the notification unless the user turned that group off. The unique
 * `(user_id, event_key)` makes a repeated delivery write nothing. Returns
 * whether a new row was created.
 */
export async function createNotification(
  db: Executor,
  input: { userId: string; type: NotificationType; subjectId: string; eventKey: string },
): Promise<{ created: boolean; skipped?: "preference" | "subject_gone" }> {
  const [prefs] = await db
    .select({ settings: userPreferences.notificationSettings })
    .from(userPreferences)
    .where(eq(userPreferences.userId, input.userId));
  const preferences = readNotificationPreferences(prefs?.settings);
  if (!preferences[preferenceFor(input.type)]) return { created: false, skipped: "preference" };

  const [document] = await db
    .select({ title: documents.title, status: documents.status })
    .from(documents)
    .where(and(eq(documents.id, input.subjectId), eq(documents.ownerId, input.userId)));
  // A document deleted before the notice went out needs no notice.
  if (!document || document.status !== "active") return { created: false, skipped: "subject_gone" };

  const template = TEMPLATES[input.type];
  const inserted = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      eventKey: input.eventKey,
      type: input.type,
      title: template.title,
      safeBody: clip(template.body(clip(document.title, 120)), 280),
      targetPath: template.path(input.subjectId),
    })
    .onConflictDoNothing({ target: [notifications.userId, notifications.eventKey] })
    .returning({ id: notifications.id });
  return { created: inserted.length > 0 };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  targetPath: string;
  read: boolean;
  createdAt: Date;
}

/** Newest first with keyset "Load more" (Section 24). */
export async function listNotifications(
  db: Executor,
  userId: string,
  { cursor, limit }: { cursor?: string | undefined; limit: number },
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const after = decodeCursor(cursor);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        after
          ? or(
              lt(notifications.createdAt, new Date(after.v)),
              and(eq(notifications.createdAt, new Date(after.v)), lt(notifications.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.safeBody,
      targetPath: row.targetPath,
      read: row.readAt !== null,
      createdAt: row.createdAt,
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ v: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function unreadNotificationCount(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

/** Marks some (or, with no IDs, all) of the user's notifications read. */
export async function markNotificationsRead(
  db: Executor,
  userId: string,
  ids?: readonly string[],
): Promise<void> {
  if (ids && ids.length === 0) return;
  await db
    .update(notifications)
    .set({ readAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, [...ids]) : undefined,
      ),
    );
}

/** Dismiss (Section 11): the recipient removes it. */
export async function dismissNotification(
  db: Executor,
  userId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  return deleted.length > 0;
}

/** Retention cleanup: removes notifications older than the retention window. */
export async function purgeOldNotifications(
  db: Executor,
  { now = new Date(), limit = 1000 }: { now?: Date; limit?: number } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    delete from notifications where id in (
      select id from notifications where created_at < ${cutoff.toISOString()}
      order by created_at limit ${limit})`);
  return result.count;
}

/** Saves the Settings switches; other stored keys are kept. */
export async function setNotificationPreferences(
  db: Executor,
  userId: string,
  preferences: Record<string, boolean>,
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, notificationSettings: preferences })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        notificationSettings: sql`${userPreferences.notificationSettings} || ${JSON.stringify(preferences)}::jsonb`,
        updatedAt: sql`now()`,
      },
    });
}

export async function getNotificationPreferences(db: Executor, userId: string) {
  const [row] = await db
    .select({ settings: userPreferences.notificationSettings })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return readNotificationPreferences(row?.settings);
}
