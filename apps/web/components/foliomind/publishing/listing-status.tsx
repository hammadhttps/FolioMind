import { StatusChip, type StatusKind } from "../status-chip";

/** How a book looks to its publisher; status always pairs an icon with text. */
export const LISTING_STATUS: Record<
  "draft" | "pending" | "published" | "rejected" | "unpublished" | "removed",
  { status: StatusKind; label: string }
> = {
  draft: { status: "draft", label: "Draft" },
  pending: { status: "pending", label: "Pending review" },
  published: { status: "ready", label: "Published" },
  rejected: { status: "attention", label: "Needs changes" },
  unpublished: { status: "draft", label: "Unpublished" },
  removed: { status: "failed", label: "Removed" },
};

export function ListingStatusChip({ status }: { status: keyof typeof LISTING_STATUS }) {
  const style = LISTING_STATUS[status];
  return <StatusChip status={style.status} label={style.label} />;
}
