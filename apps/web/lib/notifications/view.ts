import type { NotificationItem } from "@foliomind/domain";

/** What the bell drawer's client components receive. */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  targetPath: string;
  read: boolean;
  createdAt: string;
}

export function toNotificationView(item: NotificationItem): NotificationView {
  // Target paths are written by FolioMind; only in-app paths are ever followed.
  const targetPath =
    item.targetPath.startsWith("/") && !item.targetPath.startsWith("//")
      ? item.targetPath
      : "/dashboard";
  return { ...item, targetPath, createdAt: item.createdAt.toISOString() };
}
