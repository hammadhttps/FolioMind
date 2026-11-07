"use client";

import {
  PROJECT_LENGTH_TARGETS,
  PROJECT_LENGTHS,
  PROJECT_TEMPLATE_LABELS,
  PROJECT_TEMPLATES,
  studioSettingsFormSchema,
  type StudioSettingsValues,
  type StudioState,
} from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveStudioSettingsAction } from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AllowanceNote } from "./allowance-note";
import type { StudioControls } from "./use-studio";

const valuesFrom = (state: StudioState): StudioSettingsValues => ({
  prompt: state.prompt,
  audience: state.settings.audience,
  length: state.settings.length,
  template: state.template,
  pageSize: state.settings.pageSize,
  cover: state.settings.cover,
  contents: state.settings.contents,
  mode: state.mode,
});

/**
 * "Shape your document" (Sections 20 #11 and 28): prompt, audience, length and
 * template, plus page setup. Generating saves first, and leaving with unsaved
 * changes warns.
 */
export function StudioSettings({
  studio,
  busy,
  sourcesBlocked,
  hasDraft,
}: {
  studio: StudioControls;
  busy: boolean;
  sourcesBlocked: boolean;
  hasDraft: boolean;
}) {
  const { state, refresh, generate, preview } = studio;
  const [pending, setPending] = useState<"save" | "generate" | null>(null);
  const form = useForm<StudioSettingsValues>({
    resolver: zodResolver(studioSettingsFormSchema),
    mode: "onTouched",
    defaultValues: valuesFrom(state),
  });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  async function save(values: StudioSettingsValues): Promise<boolean> {
    if (preview) return false;
    const result = await saveStudioSettingsAction({ ...values, projectId: state.id }).catch(
      () => null,
    );
    if (result?.ok) {
      form.reset(values);
      await refresh();
      return true;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error(result?.formError ?? "We couldn't save these settings. Please try again.");
    return false;
  }

  /** A half-written prompt can be saved; only generating needs it complete. */
  async function saveOnly() {
    setPending("save");
    if (await save(form.getValues())) toast.success("Settings saved.");
    setPending(null);
  }

  async function generateOutline(values: StudioSettingsValues) {
    setPending("generate");
    if (await save(values)) await generate({ kind: "outline" });
    setPending(null);
  }

  const generating = pending === "generate";
  const locked = busy || state.archived;
  const hasOutline = state.outline.length > 0;

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(generateOutline)(event)}
      className="space-y-5"
    >
      <Field data-invalid={errors.prompt ? true : undefined}>
        <FieldLabel htmlFor="studio-prompt">What should this document cover?</FieldLabel>
        <Textarea
          id="studio-prompt"
          rows={4}
          disabled={locked}
          placeholder="For example: a study guide on urban heat islands for first-year students."
          className="resize-y"
          aria-invalid={errors.prompt ? true : undefined}
          aria-describedby={errors.prompt ? "studio-prompt-error" : undefined}
          {...form.register("prompt")}
        />
        <FieldError id="studio-prompt-error" errors={[errors.prompt]} />
      </Field>

      <Field data-invalid={errors.audience ? true : undefined}>
        <FieldLabel htmlFor="studio-audience">Target audience</FieldLabel>
        <Input
          id="studio-audience"
          maxLength={120}
          disabled={locked}
          placeholder="For example: first-year students"
          {...form.register("audience")}
        />
        <FieldError errors={[errors.audience]} />
      </Field>

      <Field>
        <FieldLabel htmlFor="studio-length">Approximate length</FieldLabel>
        <Controller
          control={form.control}
          name="length"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled={locked}>
              <SelectTrigger id="studio-length" className="w-full">
                <SelectValue>{lengthLabel(field.value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROJECT_LENGTHS.map((length) => (
                  <SelectItem key={length} value={length}>
                    {lengthLabel(length)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Style</legend>
        <Controller
          control={form.control}
          name="template"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              disabled={locked}
              className="gap-2"
            >
              {PROJECT_TEMPLATES.map((template) => {
                const id = `studio-style-${template}`;
                return (
                  <div
                    key={template}
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
                  >
                    <RadioGroupItem id={id} value={template} />
                    <Label htmlFor={id} className="font-normal">
                      {PROJECT_TEMPLATE_LABELS[template]}
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          )}
        />
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Writing mode</legend>
        <Controller
          control={form.control}
          name="mode"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              disabled={locked || hasDraft}
              className="gap-2"
            >
              <ModeOption value="research" label="Research" hint="Grounded in your sources" />
              <ModeOption
                value="general"
                label="General writing"
                hint="Not grounded in your sources"
              />
            </RadioGroup>
          )}
        />
        {hasDraft ? (
          <p className="text-sm text-muted-foreground">
            The mode stays fixed once a document has a draft.
          </p>
        ) : null}
      </fieldset>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="-ml-2">
            Page setup
            <ChevronDown aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3">
          <Field>
            <FieldLabel htmlFor="studio-page-size">Page size</FieldLabel>
            <Controller
              control={form.control}
              name="pageSize"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={locked}>
                  <SelectTrigger id="studio-page-size" className="w-full">
                    <SelectValue>{field.value}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="Letter">Letter</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <SwitchRow form={form} name="cover" label="Add a cover page" disabled={locked} />
          <SwitchRow form={form} name="contents" label="Add a contents page" disabled={locked} />
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={hasOutline ? "outline" : "default"}
            disabled={locked || generating || sourcesBlocked}
          >
            {generating ? <Spinner aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
            {hasOutline ? "Regenerate outline" : "Generate outline"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={locked || pending !== null || !isDirty}
            onClick={() => void saveOnly()}
          >
            {pending === "save" ? <Spinner aria-hidden="true" /> : null}
            Save settings
          </Button>
        </div>
        <AllowanceNote charge={state.charges.outline} allowance={state.allowance} />
      </div>
    </form>
  );
}

const lengthLabel = (length: (typeof PROJECT_LENGTHS)[number]) =>
  `${PROJECT_LENGTH_TARGETS[length].label}, about ${PROJECT_LENGTH_TARGETS[length].words.toLocaleString("en")} words`;

function ModeOption({ value, label, hint }: { value: string; label: string; hint: string }) {
  const id = `studio-mode-${value}`;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span>{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </Label>
    </div>
  );
}

function SwitchRow({
  form,
  name,
  label,
  disabled,
}: {
  form: ReturnType<typeof useForm<StudioSettingsValues>>;
  name: "cover" | "contents";
  label: string;
  disabled: boolean;
}) {
  const id = `studio-${name}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Switch
            id={id}
            checked={field.value}
            onCheckedChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}
