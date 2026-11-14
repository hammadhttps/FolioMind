"use client";

import {
  PUBLISHER_SLUG_MAX,
  publisherProfileSchema,
  type PublisherProfileInput,
} from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { updatePublisherProfileAction } from "@/lib/publishing/actions";
import type { PublisherAccountView } from "@/lib/publishing/view";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { Panel } from "../panel";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";

/**
 * Publisher profile (Section 5 row 12): name, biography, website and address.
 * The picture is the account's own uploaded avatar (Settings), never a
 * provider photo. The address locks once a book is published.
 */
export function PublisherProfileForm({
  account,
}: {
  account: PublisherAccountView & { profile: NonNullable<PublisherAccountView["profile"]> };
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const { profile } = account;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PublisherProfileInput>({
    resolver: zodResolver(publisherProfileSchema),
    mode: "onTouched",
    defaultValues: {
      displayName: profile.displayName,
      slug: profile.slug,
      bio: profile.bio,
      website: profile.website ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: PublisherProfileInput) {
    setFormError(null);
    if (preview) return;
    const result = await updatePublisherProfileAction(values).catch(() => null);
    if (result?.ok) {
      toast.success("Profile saved.");
      form.reset(values);
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
          name as keyof PublisherProfileInput,
          { message: messages[0] },
          { shouldFocus: true },
        );
      }
    }
    setFormError(result?.formError ?? "We couldn't save your profile. Please try again.");
  }

  return (
    <Panel
      title="Public profile"
      description="What readers see on your publisher page."
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={`/publishers/${profile.slug}`}>
            <ExternalLink aria-hidden="true" />
            View page
          </Link>
        </Button>
      }
    >
      <form
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="grid gap-4 px-5 pb-5 md:grid-cols-2"
      >
        {formError ? (
          <StatusAlert tone="error" className="md:col-span-2">
            {formError}
          </StatusAlert>
        ) : null}
        <Field data-invalid={errors.displayName ? true : undefined}>
          <FieldLabel htmlFor="profile-name">Publisher name</FieldLabel>
          <Input id="profile-name" maxLength={80} {...form.register("displayName")} />
          <FieldError errors={[errors.displayName]} />
        </Field>
        <Field data-invalid={errors.slug ? true : undefined}>
          <FieldLabel htmlFor="profile-slug">Page address</FieldLabel>
          <Input
            id="profile-slug"
            maxLength={PUBLISHER_SLUG_MAX}
            readOnly={account.slugLocked}
            aria-describedby="profile-slug-hint"
            {...form.register("slug")}
          />
          <p id="profile-slug-hint" className="text-sm text-muted-foreground">
            {account.slugLocked
              ? "Locked: published links keep working."
              : "Can change until your first book is published."}
          </p>
          <FieldError errors={[errors.slug]} />
        </Field>
        <Field data-invalid={errors.bio ? true : undefined} className="md:col-span-2">
          <FieldLabel htmlFor="profile-bio">Biography</FieldLabel>
          <Textarea id="profile-bio" rows={5} maxLength={1000} {...form.register("bio")} />
          <FieldError errors={[errors.bio]} />
        </Field>
        <Field data-invalid={errors.website ? true : undefined} className="md:col-span-2">
          <FieldLabel htmlFor="profile-website">Website (optional)</FieldLabel>
          <Input
            id="profile-website"
            type="url"
            inputMode="url"
            placeholder="https://"
            maxLength={300}
            {...form.register("website")}
          />
          <FieldError errors={[errors.website]} />
        </Field>
        <p className="text-sm text-muted-foreground md:col-span-2">
          Your page shows the picture you upload in{" "}
          <Link href="/dashboard/settings" className="text-link underline-offset-4 hover:underline">
            Settings
          </Link>
          ; a sign-in provider&apos;s photo is never shown.
        </p>
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner aria-hidden="true" /> : null}
            Save profile
          </Button>
        </div>
      </form>
    </Panel>
  );
}
