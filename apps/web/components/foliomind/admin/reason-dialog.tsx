"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AppDialog } from "../app-dialog";
import { StatusAlert } from "../status-alert";

export type DecisionResult = {
  ok: boolean;
  formError?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  code?: string;
  retryAfterSeconds?: number;
};

/**
 * A decision with a written reason (Section 28 "Moderation decision" and
 * "Suspend user"): 10 or more characters when required, shown to the
 * publisher or kept in the audit trail.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  required,
  maxLength = 1000,
  destructive = false,
  extra,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  required: boolean;
  maxLength?: number;
  destructive?: boolean;
  /** More fields, such as a suspension's end date, rendered above the reason. */
  extra?: (state: { error?: string }) => ReactNode;
  onSubmit: (reason: string | undefined) => Promise<DecisionResult | null>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = reason.trim();
    setError(null);
    setFieldErrors({});
    if (required && trimmed.length === 0) {
      setFieldErrors({ reason: ["Give a reason."] });
      return;
    }
    if (trimmed.length > 0 && trimmed.length < 10) {
      setFieldErrors({ reason: ["Write at least 10 characters."] });
      return;
    }
    setBusy(true);
    const result = await onSubmit(trimmed || undefined);
    setBusy(false);
    if (result?.ok) {
      setOpen(false);
      setReason("");
      return;
    }
    setFieldErrors(result?.fieldErrors ?? {});
    setError(result?.formError ?? "That didn't work. Please try again.");
  }

  const reasonError = fieldErrors.reason?.[0];
  return (
    <AppDialog
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setFieldErrors({});
        }
      }}
      title={title}
      description={description}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}
        {extra?.({ error: fieldErrors.endsOn?.[0] })}
        <Field data-invalid={reasonError ? true : undefined}>
          <FieldLabel htmlFor="decision-reason">
            {required ? "Reason" : "Note (optional)"}
          </FieldLabel>
          <Textarea
            id="decision-reason"
            rows={4}
            maxLength={maxLength}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? "decision-reason-error" : "decision-reason-hint"}
          />
          <p id="decision-reason-hint" className="text-sm text-muted-foreground">
            {required
              ? `10 to ${maxLength.toLocaleString("en")} characters.`
              : "At least 10 characters if you add one."}
          </p>
          <FieldError
            id="decision-reason-error"
            errors={reasonError ? [{ message: reasonError }] : []}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy}>
            {busy ? <Spinner aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}
