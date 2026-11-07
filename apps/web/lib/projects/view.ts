import {
  PROJECT_STATUS_LABELS,
  PROJECT_TEMPLATE_LABELS,
  type ProjectStatus,
} from "@foliomind/contracts";
import type { ProjectListItem } from "@foliomind/domain";
import type { StatusKind } from "@/components/foliomind/status-chip";

/** Serialized rows for the projects table (Section 20 #10). */
export interface ProjectRow {
  id: string;
  title: string;
  /** Template and sources, e.g. "Academic Report · 3 sources". */
  subtitle: string;
  status: StatusKind;
  statusLabel?: string;
  updatedLabel: string;
  /** The newest finished export; null hides Download. */
  latestExportId?: string | null;
  archived?: boolean;
}

const STATUS_KINDS: Record<ProjectStatus, StatusKind> = {
  draft: "draft",
  outline: "draft",
  drafting: "processing",
  editing: "draft",
  rendering: "processing",
  complete: "ready",
  failed: "failed",
};

export const projectStatusKind = (status: ProjectStatus): StatusKind => STATUS_KINDS[status];

const updatedFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function toProjectRow(item: ProjectListItem): ProjectRow {
  const sources =
    item.mode === "general"
      ? "General writing"
      : `${item.sourceCount} ${item.sourceCount === 1 ? "source" : "sources"}`;
  return {
    id: item.id,
    title: item.title,
    subtitle: `${PROJECT_TEMPLATE_LABELS[item.templateKey]} · ${sources}`,
    status: projectStatusKind(item.status),
    statusLabel: PROJECT_STATUS_LABELS[item.status],
    updatedLabel: updatedFormat.format(item.updatedAt),
    latestExportId: item.latestExportId,
    archived: item.archived,
  };
}
