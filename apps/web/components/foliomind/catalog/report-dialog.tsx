"use client";

import {
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  reportFormSchema,
  type ReportFormInput,
} from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Flag } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { reportBookAction } from "@/lib/catalog/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { SignInDialog } from "../sign-in-dialog";
import { StatusAlert } from "../status-alert";

const STATUS_COPY = {
  open: "You reported a concern about this book. A moderator will review it.",
  resolved: "Thanks for your report. A moderator reviewed it and acted on it.",
  dismissed: "Thanks for your report. A moderator reviewed it and left the book as it is.",
} as const;

/**
 * Report a concern (Sections 20 #3 and 28): a reason and details, required for
 * "Something else". Reporters see their report's status; moderators never see
 * who filed it.
 */
export function ReportConcern({
  bookId,
  signedIn,
  isOwner,
  report,
  returnTo,
}: {
  bookId: string;
  signedIn: boolean;
  isOwner: boolean;
  report: { status: keyof typeof STATUS_COPY } | null;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [filed, setFiled] = useState(report?.status === "open");

  if (isOwner) return null;
  if (filed || report?.status === "open") {
    return <p className="text-sm text-muted-foreground">{STATUS_COPY.open}</p>;
  }
  const trigger = (
    <Button variant="link" className="h-auto px-0 text-muted-foreground">
      <Flag aria-hidden="true" />
      Report a concern
    </Button>
  );
  return (
    <div className="space-y-1">
      {report ? (
        <p className="text-sm text-muted-foreground">{STATUS_COPY[report.status]}</p>
      ) : null}
      {signedIn ? (
        <AppDialog
          trigger={trigger}
          open={open}
          onOpenChange={setOpen}
          title="Report a concern"
          description="Tell us what's wrong with this listing. Moderators review every report."
        >
          {open ? (
            <ReportForm
              bookId={bookId}
              onCancel={() => setOpen(false)}
              onDone={() => {
                setOpen(false);
                setFiled(true);
              }}
            />
          ) : null}
        </AppDialog>
      ) : (
        <SignInDialog returnTo={returnTo}>{trigger}</SignInDialog>
      )}
    </div>
  );
}

function ReportForm({
  bookId,
  onCancel,
  onDone,
}: {
  bookId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ReportFormInput>({
    resolver: zodResolver(reportFormSchema),
    mode: "onTouched",
    defaultValues: { bookId, reason: undefined, details: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: ReportFormInput) {
    setFormError(null);
    const result = await reportBookAction(values).catch(() => null);
    if (result?.ok) {
      onDone();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else setFormError(result?.formError ?? "We couldn't send your report. Please try again.");
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-4">
      {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
      <fieldset
        className="grid gap-2"
        aria-describedby={errors.reason ? "report-reason-error" : undefined}
      >
        <legend className="mb-1 text-sm font-medium">Reason</legend>
        <Controller
          control={form.control}
          name="reason"
          render={({ field }) => (
            <RadioGroup
              value={field.value ?? ""}
              onValueChange={field.onChange}
              aria-invalid={errors.reason ? true : undefined}
              className="gap-2"
            >
              {REPORT_REASONS.map((reason) => (
                <div key={reason} className="flex items-center gap-2">
                  <RadioGroupItem value={reason} id={`report-${reason}`} />
                  <Label htmlFor={`report-${reason}`} className="font-normal">
                    {REPORT_REASON_LABELS[reason]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
        />
        <FieldError id="report-reason-error" errors={[errors.reason]} />
      </fieldset>
      <Field data-invalid={errors.details ? true : undefined}>
        <FieldLabel htmlFor="report-details">Details</FieldLabel>
        <Textarea
          id="report-details"
          rows={4}
          maxLength={1000}
          placeholder="What should a moderator know?"
          aria-invalid={errors.details ? true : undefined}
          aria-describedby={errors.details ? "report-details-error" : "report-details-hint"}
          {...form.register("details")}
        />
        <p id="report-details-hint" className="text-sm text-muted-foreground">
          10 to 1,000 characters; required for “Something else”.
        </p>
        <FieldError id="report-details-error" errors={[errors.details]} />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner aria-hidden="true" /> : null}
          Send report
        </Button>
      </div>
    </form>
  );
}
