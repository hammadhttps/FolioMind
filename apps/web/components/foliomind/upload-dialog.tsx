"use client";

import { FileUp, Globe } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppDialog } from "./app-dialog";

/**
 * My Library upload dialog layout (Sections 5, 25 and 27): Upload PDF and
 * Import from URL tabs. Phase 5 wires UploadThing and Phase 6 web import; until
 * then the controls are visibly unavailable rather than pretending to work.
 */
export function UploadDialog({ trigger }: { trigger: ReactNode }) {
  return (
    <AppDialog
      trigger={trigger}
      title="Add to your library"
      description="Upload a PDF or import one web article. Both stay private to you."
    >
      <Tabs defaultValue="upload" className="gap-4">
        <TabsList className="w-full">
          <TabsTrigger value="upload" className="flex-1">
            <FileUp aria-hidden="true" />
            Upload PDF
          </TabsTrigger>
          <TabsTrigger value="url" className="flex-1">
            <Globe aria-hidden="true" />
            Import from URL
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <div
            aria-disabled="true"
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-input/60 bg-muted/50 px-6 py-8 text-center"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-subtle text-primary-subtle-foreground">
              <FileUp className="size-6" aria-hidden="true" />
            </span>
            <p className="font-medium">Drop a PDF here or choose a file</p>
            <p className="text-sm text-muted-foreground">
              PDF up to 20 MB · text-based PDFs work best
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="upload-title">Title (optional)</Label>
            <Input
              id="upload-title"
              disabled
              maxLength={200}
              placeholder="Uses the file name if left empty"
            />
          </div>
          <DialogActions submitLabel="Upload" note="Uploads open soon." />
        </TabsContent>

        <TabsContent value="url" className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="import-url">Article URL</Label>
            <Input
              id="import-url"
              type="url"
              inputMode="url"
              disabled
              placeholder="https://example.com/article"
            />
            <p className="text-sm text-muted-foreground">
              One public article at a time. Pages behind a sign-in can&apos;t be imported.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox id="import-rights" disabled className="mt-0.5" />
            <Label htmlFor="import-rights" className="leading-snug font-normal">
              I may save this page for personal study.
            </Label>
          </div>
          <DialogActions submitLabel="Import" note="Web import opens soon." />
        </TabsContent>
      </Tabs>
    </AppDialog>
  );
}

function DialogActions({ submitLabel, note }: { submitLabel: string; note: string }) {
  return (
    <div className="flex flex-col-reverse items-stretch gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
      <p className="text-sm text-muted-foreground sm:mr-auto">{note}</p>
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button disabled>{submitLabel}</Button>
    </div>
  );
}
