import { Bold, Check, FileDown, Italic, List, ListTree, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { Paper } from "../paper";

/**
 * PDF Studio (Section 20 #11): "Shape your document" rail and the warm-paper
 * editor. Outline approval, drafting and export arrive in Phase 8; the explicit
 * approval step stays in the layout.
 */
export function PdfStudioScreen() {
  return (
    <div className="space-y-5">
      <PageHeading
        title="PDF Studio"
        description="Describe your document, approve an outline, then edit the draft it becomes."
        actions={
          <>
            <ComingSoonButton variant="outline" reason="Projects open soon">
              <Pencil aria-hidden="true" />
              Rename
            </ComingSoonButton>
            <ComingSoonButton reason="Export opens soon">
              <FileDown aria-hidden="true" />
              Export PDF
            </ComingSoonButton>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Shape your document" contentClassName="space-y-5 pt-0">
          <div className="grid gap-1.5">
            <Label htmlFor="studio-prompt">What should this document cover?</Label>
            <Textarea
              id="studio-prompt"
              disabled
              rows={4}
              placeholder="For example: a study guide on urban heat islands for first-year students."
              className="resize-none"
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Style</legend>
            <RadioGroup defaultValue="academic-report" disabled className="gap-2">
              <StyleOption value="academic-report" label="Academic Report" />
              <StyleOption value="study-notes" label="Study Notes" />
            </RadioGroup>
          </fieldset>

          <div className="space-y-1">
            <p className="text-sm font-medium">Sources</p>
            <p className="text-sm text-muted-foreground">No sources connected.</p>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListTree className="size-4" aria-hidden="true" />
              Outline
            </p>
            <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              Your outline appears here once you describe the document.
            </p>
          </div>

          <ComingSoonButton variant="research" className="w-full" reason="Drafting opens soon">
            <Check aria-hidden="true" />
            Approve &amp; create draft
          </ComingSoonButton>
        </Panel>

        <section aria-label="Editor" className="min-w-0 overflow-hidden rounded-xl border bg-muted">
          <div
            role="toolbar"
            aria-label="Formatting"
            className="flex items-center gap-1 border-b bg-card px-2 py-1.5"
          >
            <EditorToggle label="Bold">
              <Bold />
            </EditorToggle>
            <EditorToggle label="Italic">
              <Italic />
            </EditorToggle>
            <EditorToggle label="Bulleted list">
              <List />
            </EditorToggle>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <span className="ml-auto px-2 text-sm text-muted-foreground">Not saved yet</span>
          </div>
          <div className="p-4 md:p-8">
            <Paper className="flex min-h-[420px] flex-col items-center justify-center text-center md:min-h-[600px]">
              <p className="font-serif text-xl font-semibold">Your draft appears here.</p>
              <p className="mt-2 max-w-sm font-sans text-[0.9375rem] text-paper-ink/70">
                Approve an outline and FolioMind drafts each section for you to edit.
              </p>
            </Paper>
          </div>
        </section>
      </div>
    </div>
  );
}

function StyleOption({ value, label }: { value: string; label: string }) {
  const id = `studio-style-${value}`;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

function EditorToggle({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Toggle size="sm" disabled aria-label={label} className="[&_svg]:size-4">
      {children}
    </Toggle>
  );
}
