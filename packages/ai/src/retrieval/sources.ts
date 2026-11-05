import type { Database, Executor } from "@foliomind/db";
import { workspaceSources } from "@foliomind/db";
import { ownsWorkspace, readableSources, type Actor } from "@foliomind/domain";
import { asc, eq } from "drizzle-orm";

/*
 * Section 8 step 1: which ready versions this user may search for this scope,
 * checked on every question. The scope comes from the stored conversation or
 * the checked request; conversation text can never name a document.
 */

export type SourceScope =
  | { kind: "document"; versionId: string }
  | {
      kind: "workspace";
      workspaceId: string;
      /** The sources ticked in the rail. Only ever narrows the workspace's own sources. */
      selectedVersionIds?: readonly string[] | undefined;
    };

export interface ResolvedSource {
  versionId: string;
  documentId: string;
  title: string;
}

export async function resolveSources(
  db: Database | Executor,
  actor: Actor,
  scope: SourceScope,
): Promise<ResolvedSource[]> {
  let versionIds: string[];
  if (scope.kind === "document") {
    versionIds = [scope.versionId];
  } else {
    if (!(await ownsWorkspace(db, actor, scope.workspaceId))) return [];
    const rows = await db
      .select({ versionId: workspaceSources.documentVersionId })
      .from(workspaceSources)
      .where(eq(workspaceSources.workspaceId, scope.workspaceId))
      .orderBy(asc(workspaceSources.position));
    const selected = scope.selectedVersionIds ? new Set(scope.selectedVersionIds) : null;
    versionIds = rows
      .map((row) => row.versionId)
      .filter((versionId) => !selected || selected.has(versionId));
  }
  const readable = new Map(
    (await readableSources(db, actor, versionIds)).map((source) => [source.versionId, source]),
  );
  // Keeps the rail's order, so passages list sources the way the reader sees them.
  return versionIds.flatMap((versionId) => {
    const source = readable.get(versionId);
    return source?.status === "ready"
      ? [{ versionId, documentId: source.documentId, title: source.title }]
      : [];
  });
}
