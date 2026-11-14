import "server-only";
import type {
  AdminJobRow,
  AdminUserRow,
  ApplicationRow,
  AuditRow,
  ReportRow,
  SubmissionDetail,
  SubmissionRow,
} from "@foliomind/domain";
import { coverImageUrl } from "@/lib/catalog/view";

/* Serializable admin views; dates become ISO strings for client components. */

const iso = (value: Date | null) => value?.toISOString() ?? null;

export type SubmissionRowView = Omit<SubmissionRow, "updatedAt"> & { updatedAt: string };
export const toSubmissionRow = (row: SubmissionRow): SubmissionRowView => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});

export type SubmissionDetailView = Omit<SubmissionDetail, "updatedAt" | "coverKey"> & {
  updatedAt: string;
  coverUrl: string | null;
};
export function toSubmissionDetail(detail: SubmissionDetail): SubmissionDetailView {
  const { coverKey, ...rest } = detail;
  return { ...rest, updatedAt: detail.updatedAt.toISOString(), coverUrl: coverImageUrl(coverKey) };
}

export type ReportRowView = Omit<ReportRow, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export const toReportRow = (row: ReportRow): ReportRowView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export type ApplicationRowView = Omit<ApplicationRow, "updatedAt"> & { updatedAt: string };
export const toApplicationRow = (row: ApplicationRow): ApplicationRowView => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});

export type AdminUserRowView = Omit<AdminUserRow, "createdAt" | "suspendedUntil"> & {
  createdAt: string;
  suspendedUntil: string | null;
};
export const toAdminUserRow = (row: AdminUserRow): AdminUserRowView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  suspendedUntil: iso(row.suspendedUntil),
});

export type AdminJobRowView = Omit<AdminJobRow, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export const toAdminJobRow = (row: AdminJobRow): AdminJobRowView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export type AuditRowView = Omit<AuditRow, "createdAt"> & { createdAt: string };
export const toAuditRow = (row: AuditRow): AuditRowView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

export interface KeysetPageView<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
}
