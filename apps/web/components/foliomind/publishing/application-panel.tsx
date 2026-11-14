"use client";

import {
  PUBLISHER_SLUG_MAX,
  publisherApplicationSchema,
  type PublisherApplicationInput,
} from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { applyToPublishAction } from "@/lib/publishing/actions";
import type { PublisherAccountView } from "@/lib/publishing/view";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { Panel } from "../panel";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";
import { StatusChip } from "../status-chip";

/**
 * Publisher application and its status (Sections 5 row 12, 22 rule 2 and 28).
 * Readers with a verified email apply; an admin approves or rejects with a
 * reason. A rejected applicant can apply again.
 */
export function ApplicationPanel({
  account,
  emailVerified,
  isAdmin,
}: {
  account: PublisherAccountView;
  emailVerified: boolean;
  isAdmin: boolean;
}) {
  const profile = account.profile;
  if (isAdmin) {
    return (
      <StatusAlert tone="info" title="Administrator accounts can't publish">
        Publishing is for publisher accounts. To publish, apply from a separate reader account.
      </StatusAlert>
    );
  }
  if (profile?.status === "suspended") {
    return (
      <StatusAlert tone="warning" title="Your publisher profile is suspended">
        Your books aren&apos;t shown in the library while it&apos;s suspended.
      </StatusAlert>
    );
  }
  if (profile?.status === "applicant") {
    return (
      <Panel
        title="Your application is waiting for review"
        description="An administrator reviews every application. You'll get a notification with the decision."
      >
        <dl className="grid gap-3 px-5 pb-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Publisher name</dt>
            <dd className="font-medium [overflow-wrap:anywhere]">{profile.displayName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Page address</dt>
            <dd className="font-medium">/publishers/{profile.slug}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="mt-1">
              <StatusChip status="pending" label="Under review" />
            </dd>
          </div>
        </dl>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      {profile?.status === "rejected" ? (
        <StatusAlert tone="error" title="Your application wasn't approved">
          {profile.reviewReason ? (
            <span className="whitespace-pre-line">{profile.reviewReason}</span>
          ) : (
            "You can update your details and apply again."
          )}
        </StatusAlert>
      ) : null}
      {!emailVerified ? (
        <StatusAlert tone="warning" title="Verify your email to apply">
          Your sign-in provider hasn&apos;t confirmed your email address. Verify it there, then sign
          in again to apply.
        </StatusAlert>
      ) : null}
      <Panel
        title={profile ? "Apply again" : "Apply to publish"}
        description="Tell readers who you are. Approved publishers can share books they're authorized to publish."
      >
        <ApplicationForm
          disabled={!emailVerified}
          defaults={{
            displayName: profile?.displayName ?? "",
            slug: profile?.slug ?? "",
            bio: profile?.bio ?? "",
            website: profile?.website ?? "",
          }}
        />
      </Panel>
    </div>
  );
}

function ApplicationForm({
  disabled,
  defaults,
}: {
  disabled: boolean;
  defaults: { displayName: string; slug: string; bio: string; website: string };
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PublisherApplicationInput>({
    resolver: zodResolver(publisherApplicationSchema),
    mode: "onTouched",
    defaultValues: { ...defaults, rightsConfirmed: false as unknown as true },
  });
  const { errors, isSubmitting } = form.formState;
  const bio = useWatch({ control: form.control, name: "bio" }) ?? "";

  async function submit(values: PublisherApplicationInput) {
    setFormError(null);
    if (preview) return;
    const result = await applyToPublishAction(values).catch(() => null);
    if (result?.ok) {
      toast.success("Application sent. We'll let you know when it's reviewed.");
      router.refresh();
      return;
    }
    if (result?.code === "rate_limited") {
      showRateLimitToast(result.retryAfterSeconds);
      return;
    }
    for (const [name, messages] of Object.entries(result?.fieldErrors ?? {})) {
      if (messages?.[0]) {
        form.setError(
          name as keyof PublisherApplicationInput,
          { message: messages[0] },
          { shouldFocus: true },
        );
      }
    }
    setFormError(result?.formError ?? "We couldn't send your application. Please try again.");
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      className="space-y-4 px-5 pb-5"
    >
      {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
      <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
        <Field data-invalid={errors.displayName ? true : undefined}>
          <FieldLabel htmlFor="apply-name">Publisher name</FieldLabel>
          <Input
            id="apply-name"
            maxLength={80}
            aria-invalid={errors.displayName ? true : undefined}
            aria-describedby={errors.displayName ? "apply-name-error" : undefined}
            {...form.register("displayName")}
          />
          <FieldError id="apply-name-error" errors={[errors.displayName]} />
        </Field>
        <Field data-invalid={errors.slug ? true : undefined}>
          <FieldLabel htmlFor="apply-slug">Page address</FieldLabel>
          <Input
            id="apply-slug"
            maxLength={PUBLISHER_SLUG_MAX}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={errors.slug ? "apply-slug-error" : "apply-slug-hint"}
            {...form.register("slug")}
          />
          <p id="apply-slug-hint" className="text-sm text-muted-foreground">
            /publishers/your-address · lowercase letters, numbers and hyphens. It can&apos;t change
            after your first book is published.
          </p>
          <FieldError id="apply-slug-error" errors={[errors.slug]} />
        </Field>
        <Field data-invalid={errors.bio ? true : undefined} className="md:col-span-2">
          <FieldLabel htmlFor="apply-bio">Biography</FieldLabel>
          <Textarea
            id="apply-bio"
            rows={5}
            maxLength={1000}
            aria-invalid={errors.bio ? true : undefined}
            aria-describedby={errors.bio ? "apply-bio-error" : "apply-bio-hint"}
            {...form.register("bio")}
          />
          <p id="apply-bio-hint" className="text-sm text-muted-foreground">
            50 to 1,000 characters ({bio.trim().length} so far). Shown on your public page.
          </p>
          <FieldError id="apply-bio-error" errors={[errors.bio]} />
        </Field>
        <Field data-invalid={errors.website ? true : undefined} className="md:col-span-2">
          <FieldLabel htmlFor="apply-website">Website (optional)</FieldLabel>
          <Input
            id="apply-website"
            type="url"
            inputMode="url"
            placeholder="https://"
            maxLength={300}
            aria-invalid={errors.website ? true : undefined}
            aria-describedby={errors.website ? "apply-website-error" : undefined}
            {...form.register("website")}
          />
          <FieldError id="apply-website-error" errors={[errors.website]} />
        </Field>
        <Field data-invalid={errors.rightsConfirmed ? true : undefined} className="md:col-span-2">
          <Controller
            control={form.control}
            name="rightsConfirmed"
            render={({ field }) => (
              <div className="flex items-start gap-3">
                <Checkbox
                  id="apply-rights"
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  aria-invalid={errors.rightsConfirmed ? true : undefined}
                  aria-describedby={errors.rightsConfirmed ? "apply-rights-error" : undefined}
                />
                <Label htmlFor="apply-rights" className="leading-normal font-normal">
                  I&apos;ll only publish books I hold the rights to share, or that I&apos;m
                  authorized to publish.
                </Label>
              </div>
            )}
          />
          <FieldError id="apply-rights-error" errors={[errors.rightsConfirmed]} />
        </Field>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? <Spinner aria-hidden="true" /> : <Send aria-hidden="true" />}
          Send application
        </Button>
      </div>
    </form>
  );
}
