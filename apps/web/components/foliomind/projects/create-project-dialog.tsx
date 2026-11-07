"use client";

import {
  createProjectSchema,
  PROJECT_SOURCES_MAX,
  type CreateProjectValues,
} from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { createProjectAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";
import { ProjectSourceList } from "./project-source-list";

/**
 * Create dialog (Sections 20 #10 and 28): a title and a starting point, research
 * sources or general writing. Creating charges nothing: the credit is taken when
 * an outline is generated (Section 10).
 */
export function CreateProjectDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AppDialog
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      title="Create a PDF"
      description="Start from your sources, or write about any topic. Nothing is generated yet."
    >
      {open ? <CreateProjectForm onCancel={() => setOpen(false)} /> : null}
    </AppDialog>
  );
}

function CreateProjectForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    mode: "onTouched",
    defaultValues: { title: "", mode: "research", versionIds: [] },
  });
  const { errors, isSubmitting } = form.formState;
  const mode = useWatch({ control: form.control, name: "mode" });
  const selected = useWatch({ control: form.control, name: "versionIds" });

  // Research is the default when sources exist; with none, general writing is what's left.
  const onEmptyLibrary = useCallback(() => {
    if (form.getValues("versionIds").length === 0) form.setValue("mode", "general");
  }, [form]);

  async function submit(values: CreateProjectValues) {
    setFormError(null);
    if (preview) return;
    const result = await createProjectAction(values).catch(() => null);
    if (result?.ok) {
      router.push(`/dashboard/projects/${result.data.projectId}`);
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else setFormError(result?.formError ?? "We couldn't create that project. Please try again.");
  }

  function toggle(versionId: string, on: boolean) {
    const next = on
      ? [...new Set([...selected, versionId])]
      : selected.filter((id) => id !== versionId);
    form.setValue("versionIds", next, { shouldValidate: true });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-4">
      {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="project-title">Title</FieldLabel>
        <Input
          id="project-title"
          autoFocus
          maxLength={120}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "project-title-error" : undefined}
          {...form.register("title")}
        />
        <FieldError id="project-title-error" errors={[errors.title]} />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Starting point</legend>
        <Controller
          control={form.control}
          name="mode"
          render={({ field }) => (
            <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
              <ModeOption
                value="research"
                label="Research sources"
                description="Grounded in documents you choose, with citations."
              />
              <ModeOption
                value="general"
                label="General writing"
                description="AI generated from a topic, not grounded in your sources."
              />
            </RadioGroup>
          )}
        />
      </fieldset>

      {mode === "research" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Sources{" "}
            <span className="font-normal text-muted-foreground">
              ({selected.length} of up to {PROJECT_SOURCES_MAX})
            </span>
          </p>
          <ProjectSourceList
            onEmptyLibrary={onEmptyLibrary}
            renderAction={(item) => (
              <Checkbox
                aria-label={`Use ${item.title}`}
                checked={selected.includes(item.versionId)}
                disabled={
                  !selected.includes(item.versionId) && selected.length >= PROJECT_SOURCES_MAX
                }
                onCheckedChange={(checked) => toggle(item.versionId, checked === true)}
              />
            )}
          />
          {errors.versionIds ? (
            <p className="text-sm text-error" role="alert">
              {errors.versionIds.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner aria-hidden="true" /> : null}
          Create project
        </Button>
      </div>
    </form>
  );
}

function ModeOption({
  value,
  label,
  description,
}: {
  value: string;
  label: string;
  description: string;
}) {
  const id = `project-mode-${value}`;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </Label>
    </div>
  );
}
