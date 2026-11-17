"use client";

import { DELETE_ACCOUNT_PHRASE } from "@foliomind/contracts";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { deleteAccountAction } from "@/lib/account/deletion";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";

/**
 * Delete account (Sections 6 and 28): plain language about what goes and what
 * stays, the exact confirmation phrase, and a recent sign-in. On success the
 * session ends and the sign-in page confirms the deletion.
 */
export function DeleteAccountDialog({ reauthHref }: { reauthHref: string | null }) {
  const preview = useIsPreview();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setFieldError(null);
    if (phrase.trim().toLowerCase() !== DELETE_ACCOUNT_PHRASE) {
      setFieldError(`Type “${DELETE_ACCOUNT_PHRASE}” to confirm.`);
      return;
    }
    if (preview) return;
    setBusy(true);
    const result = await deleteAccountAction({ confirmation: phrase }).catch(() => null);
    if (result?.ok) {
      // Ends the session; the sign-in page explains the account was deleted.
      window.location.assign(new URL("/session/end?reason=deleted", window.location.origin).href);
      return;
    }
    setBusy(false);
    if (result?.code === "rate_limited") {
      showRateLimitToast(result.retryAfterSeconds);
      return;
    }
    if (result?.code === "reauthentication_required") setNeedsReauth(true);
    setError(result?.formError ?? "We couldn't delete your account. Please try again.");
  }

  return (
    <AppDialog
      trigger={
        <Button variant="destructive">
          <Trash2 aria-hidden="true" />
          Delete account
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPhrase("");
          setError(null);
          setFieldError(null);
        }
      }}
      title="Delete your account?"
      description="This can't be undone."
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/85">
          <li>Your uploads, imports, notes, workspaces, projects and exports are deleted.</li>
          <li>A Pro subscription is cancelled at once and won&apos;t renew.</li>
          <li>Books you publish leave the library.</li>
          <li>
            Billing and audit records the law or security needs are kept, without your name or
            email. See the{" "}
            <Link href="/privacy/retention" className="text-link underline underline-offset-4">
              data retention page
            </Link>
            .
          </li>
        </ul>
        {error ? (
          <StatusAlert
            tone="error"
            action={
              needsReauth && reauthHref ? (
                <Button asChild size="sm" variant="outline">
                  <a href={reauthHref}>Sign in again</a>
                </Button>
              ) : undefined
            }
          >
            {error}
          </StatusAlert>
        ) : null}
        <Field data-invalid={fieldError ? true : undefined}>
          <FieldLabel htmlFor="delete-confirmation">
            Type <span className="font-semibold">{DELETE_ACCOUNT_PHRASE}</span> to confirm
          </FieldLabel>
          <Input
            id="delete-confirmation"
            autoComplete="off"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "delete-confirmation-error" : undefined}
          />
          <FieldError
            id="delete-confirmation-error"
            errors={fieldError ? [{ message: fieldError }] : []}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep my account
          </Button>
          <Button type="submit" variant="destructive" disabled={busy}>
            {busy ? <Spinner aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            Delete account
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}
