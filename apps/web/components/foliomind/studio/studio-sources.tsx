"use client";

import { PROJECT_SOURCES_MAX, type ProjectSourceView } from "@foliomind/contracts";
import { CircleAlert, FileText, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { addProjectSourceAction, removeProjectSourceAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { ProjectSourceList } from "../projects/project-source-list";
import { StatusAlert } from "../status-alert";
import type { StudioControls } from "./use-studio";

/**
 * The connected sources (Section 20 #11): exact versions, pinned when added. A
 * source that became inaccessible blocks new generation with a clear reason
 * (Section 8), and removing it clears the block.
 */
export function StudioSources({ studio, busy }: { studio: StudioControls; busy: boolean }) {
  const { state, refresh, preview } = studio;
  const [picking, setPicking] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const research = state.mode === "research";
  const blocked = state.sources.some((source) => !source.available);
  const locked = busy || state.archived || preview;

  async function change(
    action: typeof addProjectSourceAction,
    versionId: string,
    success?: string,
  ) {
    setWorking(versionId);
    const result = await action({ projectId: state.id, versionId }).catch(() => null);
    setWorking(null);
    if (result?.ok) {
      if (success) toast.success(success);
      await refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error(result?.formError ?? "That didn't work. Please try again.");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Sources</p>
        {research ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked || state.sources.length >= PROJECT_SOURCES_MAX}
            onClick={() => setPicking(true)}
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
        ) : null}
      </div>
      {!research ? (
        <p className="text-sm text-muted-foreground">
          General writing doesn&apos;t use your sources.
        </p>
      ) : state.sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sources connected. Add at least one, or switch to general writing.
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Connected sources">
          {state.sources.map((source) => (
            <SourceRow
              key={source.versionId}
              source={source}
              disabled={locked}
              working={working === source.versionId}
              onRemove={() => void change(removeProjectSourceAction, source.versionId)}
            />
          ))}
        </ul>
      )}
      {research && blocked ? (
        <StatusAlert tone="warning" title="A source isn't available anymore.">
          Remove it or pick another before generating. Text already written keeps its citations.
        </StatusAlert>
      ) : null}

      <AppDialog
        open={picking}
        onOpenChange={setPicking}
        title="Add sources"
        description={`Only documents that have finished processing can be added, up to ${PROJECT_SOURCES_MAX}.`}
      >
        {picking ? (
          <div className="space-y-3">
            <ProjectSourceList
              exclude={state.sources.map((source) => source.versionId)}
              renderAction={(item) => (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Add ${item.title}`}
                  disabled={working !== null || state.sources.length >= PROJECT_SOURCES_MAX}
                  onClick={() =>
                    void change(addProjectSourceAction, item.versionId, "Source added.")
                  }
                >
                  {working === item.versionId ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  Add
                </Button>
              )}
            />
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => setPicking(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </AppDialog>
    </div>
  );
}

function SourceRow({
  source,
  disabled,
  working,
  onRemove,
}: {
  source: ProjectSourceView;
  disabled: boolean;
  working: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      {source.available ? (
        <FileText aria-hidden="true" className="size-4 shrink-0 text-research" />
      ) : (
        <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{source.title}</p>
        {source.available ? null : (
          <p className="text-xs text-muted-foreground">No longer available</p>
        )}
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${source.title}`}
        disabled={disabled}
        onClick={onRemove}
      >
        {working ? <Spinner aria-hidden="true" /> : <X aria-hidden="true" />}
      </Button>
    </li>
  );
}
