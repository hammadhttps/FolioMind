"use client";

import {
  docSectionIds,
  outlineSchema,
  type OutlineSection,
  type ProjectDoc,
} from "@foliomind/contracts";
import { ArrowDown, ArrowUp, Check, ListTree, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { saveOutlineAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { StatusAlert } from "../status-alert";
import { AllowanceNote } from "./allowance-note";
import type { StudioControls } from "./use-studio";

const SAVE_AFTER_MS = 800;
const MAX_SECTIONS = 15;
const MIN_SECTIONS = 3;

/**
 * The numbered outline (Section 28: 3–15 sections, heading 1–150 characters, notes
 * up to 500) and the explicit approval. Nothing is drafted until the owner presses
 * the teal button. Once a draft exists, each section can be rewritten on its own.
 */
export function StudioOutline({
  studio,
  busy,
  sourcesBlocked,
  doc,
  onBeforeDraft,
}: {
  studio: StudioControls;
  busy: boolean;
  sourcesBlocked: boolean;
  doc: ProjectDoc;
  /** Saves the editor first, so a redraft keeps the very latest text as a revision. */
  onBeforeDraft: () => Promise<boolean>;
}) {
  const { state, generate, refresh, preview } = studio;
  const [sections, setSections] = useState<OutlineSection[]>(state.outline);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [regenerating, setRegenerating] = useState<OutlineSection | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverOutline = JSON.stringify(state.outline);
  const locked = busy || state.archived;
  const written = useMemo(() => new Set(docSectionIds(doc)), [doc]);
  const proposed = useMemo(
    () => new Set(state.proposals.map((proposal) => proposal.sectionId)),
    [state.proposals],
  );

  // A freshly generated outline replaces what's on screen; the owner's unsaved edits never do.
  useEffect(() => {
    if (!dirty.current) setSections(JSON.parse(serverOutline) as OutlineSection[]);
  }, [serverOutline]);

  async function persist(next: OutlineSection[]): Promise<boolean> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const parsed = outlineSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the outline.");
      return false;
    }
    setError(null);
    if (!dirty.current) return true;
    if (preview) return false;
    setSaving(true);
    const result = await saveOutlineAction({ projectId: state.id, outline: parsed.data }).catch(
      () => null,
    );
    setSaving(false);
    if (result?.ok) {
      dirty.current = false;
      await refresh();
      return true;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else setError(result?.formError ?? "We couldn't save the outline. Please try again.");
    return false;
  }

  function update(next: OutlineSection[]) {
    dirty.current = true;
    setSections(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(next), SAVE_AFTER_MS);
  }

  const edit = (index: number, change: Partial<OutlineSection>) =>
    update(sections.map((section, at) => (at === index ? { ...section, ...change } : section)));

  function move(index: number, by: -1 | 1) {
    const next = [...sections];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    update(next);
  }

  async function startDraft(replace: boolean) {
    setStarting(true);
    const ready = (await persist(sections)) && (!replace || (await onBeforeDraft()));
    if (ready) await generate({ kind: "draft", replace });
    setStarting(false);
  }

  async function approve() {
    if (state.firstDraftDone) {
      setConfirmReplace(true);
      return;
    }
    await startDraft(false);
  }

  if (sections.length === 0) {
    return (
      <div className="space-y-2">
        <OutlineHeading saving={false} />
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          Your outline appears here once you describe the document.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <OutlineHeading saving={saving} />
      {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}
      <ol className="space-y-2" aria-label="Outline sections">
        {sections.map((section, index) => (
          <li key={section.id} className="space-y-1.5 rounded-lg border bg-card p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center text-sm font-medium text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <Input
                aria-label={`Section ${index + 1} heading`}
                value={section.heading}
                maxLength={150}
                disabled={locked}
                className="h-8 min-w-0 flex-1"
                onChange={(event) => edit(index, { heading: event.target.value })}
              />
            </div>
            <Textarea
              aria-label={`Section ${index + 1} notes`}
              value={section.notes}
              maxLength={500}
              rows={2}
              disabled={locked}
              placeholder="What this section should cover (optional)"
              className="min-h-0 resize-y text-sm"
              onChange={(event) => edit(index, { notes: event.target.value })}
            />
            <div className="flex flex-wrap items-center gap-1">
              {written.has(section.id) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={locked || proposed.has(section.id) || sourcesBlocked}
                  onClick={() => setRegenerating(section)}
                >
                  <RefreshCw aria-hidden="true" />
                  {proposed.has(section.id) ? "New version waiting" : "Regenerate section"}
                </Button>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move section ${index + 1} up`}
                  disabled={locked || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move section ${index + 1} down`}
                  disabled={locked || index === sections.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove section ${index + 1}`}
                  disabled={locked || sections.length <= MIN_SECTIONS}
                  onClick={() => update(sections.filter((_, at) => at !== index))}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={locked || sections.length >= MAX_SECTIONS}
        onClick={() =>
          update([...sections, { id: crypto.randomUUID(), heading: "New section", notes: "" }])
        }
      >
        <Plus aria-hidden="true" />
        Add a section
      </Button>

      <div className="space-y-2 border-t pt-3">
        <Button
          type="button"
          variant="research"
          className="w-full"
          disabled={locked || starting || sourcesBlocked || saving}
          onClick={() => void approve()}
        >
          {starting ? <Spinner aria-hidden="true" /> : <Check aria-hidden="true" />}
          Approve &amp; create draft
        </Button>
        <AllowanceNote charge={state.charges.draft} allowance={state.allowance} />
      </div>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your draft?</AlertDialogTitle>
            <AlertDialogDescription>
              FolioMind will write every section again from this outline. Your current text is saved
              as a revision first, so you can go back to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AllowanceNote charge="regeneration" allowance={state.allowance} />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my draft</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startDraft(true)}>
              Replace draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={regenerating !== null}
        onOpenChange={(open) => {
          if (!open) setRegenerating(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate “{regenerating?.heading}”?</AlertDialogTitle>
            <AlertDialogDescription>
              FolioMind writes a new version and shows it beside your text. Nothing changes unless
              you choose it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AllowanceNote charge="regeneration" allowance={state.allowance} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const section = regenerating;
                if (!section) return;
                void onBeforeDraft().then((saved) => {
                  if (saved) void generate({ kind: "section", sectionId: section.id });
                  else toast.error("Save your changes first. We couldn't save them just now.");
                });
              }}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OutlineHeading({ saving }: { saving: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium">
      <ListTree className="size-4" aria-hidden="true" />
      Outline
      {saving ? (
        <span className="flex items-center gap-1 font-normal text-muted-foreground">
          <Spinner aria-hidden="true" className="size-3" />
          Saving
        </span>
      ) : null}
    </p>
  );
}
