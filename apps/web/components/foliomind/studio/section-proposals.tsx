"use client";

import { sectionNodes, type ProjectDoc, type SectionProposal } from "@foliomind/contracts";
import { Check, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { acceptProposalAction, declineProposalAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import type { StudioControls } from "./use-studio";
import type { EditorHandle } from "./studio-editor";

const DocPreview = dynamic(() => import("./doc-preview"), {
  ssr: false,
  loading: () => <Skeleton className="h-32 w-full rounded-lg" />,
});

/**
 * A regenerated section beside the current text (Section 5 row 11): the owner
 * decides, and nothing is replaced until they do. Keeping their own text costs
 * nothing further; choosing the new one keeps theirs as a revision.
 */
export function SectionProposals({
  studio,
  doc,
  editor,
}: {
  studio: StudioControls;
  doc: ProjectDoc;
  editor: React.RefObject<EditorHandle | null>;
}) {
  const { state } = studio;
  if (state.proposals.length === 0) return null;
  return (
    <div className="space-y-3">
      {state.proposals.map((proposal) => (
        <ProposalCard
          key={proposal.jobId}
          studio={studio}
          proposal={proposal}
          doc={doc}
          editor={editor}
        />
      ))}
    </div>
  );
}

function ProposalCard({
  studio,
  proposal,
  doc,
  editor,
}: {
  studio: StudioControls;
  proposal: SectionProposal;
  doc: ProjectDoc;
  editor: React.RefObject<EditorHandle | null>;
}) {
  const { state, refresh, counterRef, preview } = studio;
  const [working, setWorking] = useState<"accept" | "decline" | null>(null);
  const current = sectionNodes(doc, proposal.sectionId);
  const heading = proposal.nodes[0];
  const title =
    heading?.type === "heading"
      ? (heading.content ?? []).map((node) => (node.type === "text" ? node.text : "")).join("")
      : "this section";

  async function accept() {
    if (preview) return;
    setWorking("accept");
    // Anything still being typed is saved first, so it's part of the kept revision.
    if (!(await editor.current?.flush())) {
      setWorking(null);
      toast.error("Save your changes first. We couldn't save them just now.");
      return;
    }
    const result = await acceptProposalAction({
      projectId: state.id,
      sectionId: proposal.sectionId,
      baseCounter: counterRef.current,
    }).catch(() => null);
    setWorking(null);
    if (result?.ok) {
      editor.current?.replace(result.data.content, result.data.counter);
      toast.success("New version in place. Your earlier text is saved as a revision.");
      await refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else if (result?.code === "conflict") {
      toast.error("This project changed in another tab. Reload the page, then choose again.");
    } else {
      toast.error(
        (result && "formError" in result ? result.formError : undefined) ??
          "We couldn't use that version. Please try again.",
      );
    }
  }

  async function decline() {
    if (preview) return;
    setWorking("decline");
    const result = await declineProposalAction({
      projectId: state.id,
      sectionId: proposal.sectionId,
    }).catch(() => null);
    setWorking(null);
    if (result?.ok) {
      await refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error("That didn't work. Please try again.");
  }

  return (
    <section
      aria-label={`New version of ${title}`}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 font-semibold">New version of “{title}”</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={working !== null}
            onClick={() => void decline()}
          >
            {working === "decline" ? <Spinner aria-hidden="true" /> : <X aria-hidden="true" />}
            Keep my text
          </Button>
          <Button
            variant="research"
            size="sm"
            disabled={working !== null || !current}
            onClick={() => void accept()}
          >
            {working === "accept" ? <Spinner aria-hidden="true" /> : <Check aria-hidden="true" />}
            Use this version
          </Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">Your text</p>
          <div className="max-h-96 overflow-y-auto rounded-lg border bg-paper p-4 font-serif text-paper-ink">
            {current ? (
              <DocPreview nodes={current} label="Your text" />
            ) : (
              <p className="text-sm">This section isn&apos;t in the document anymore.</p>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">New version</p>
          <div className="max-h-96 overflow-y-auto rounded-lg border bg-paper p-4 font-serif text-paper-ink">
            <DocPreview nodes={proposal.nodes} label="New version" />
          </div>
        </div>
      </div>
    </section>
  );
}
