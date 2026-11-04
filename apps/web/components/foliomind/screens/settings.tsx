"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  NOTIFICATION_PREFERENCES,
  profileFormSchema,
  SIGN_IN_PROVIDER_NAMES,
  type NotificationPreferenceKey,
  type NotificationPreferences,
  type ProfileFormValues,
  type SignInProvider,
} from "@foliomind/contracts";
import { Link2, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { GitHubMark, GoogleMark } from "@/components/icons/brand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { updateProfile } from "@/lib/account/actions";
import { updateNotificationPreferencesAction } from "@/lib/notifications/actions";
import { IDENTITY_SUCCESS_CODES, identityMessage } from "@/lib/account/identity-messages";
import { loginHref } from "@/lib/auth/return-to";
import { useUploadThing } from "@/lib/uploadthing";
import { handleRateLimitResponse, showRateLimitToast } from "@/lib/rate-limit-toast";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { useIsPreview, useSessionUser } from "../session-user";
import { StatusAlert } from "../status-alert";
import { usePersistedTheme } from "../theme-preference";
import { UserAvatar } from "../user-avatar";

const noopSubscribe = () => () => {};

export interface SignInMethodView {
  provider: SignInProvider;
  connected: boolean;
  email: string | null;
  /** The method the account was created with; it cannot be disconnected. */
  primary: boolean;
}

/**
 * Account Settings (Section 20 #13): profile, appearance, notification
 * preferences and sign-in methods are saved to the account; account deletion
 * opens in Phase 10. Email and verification are managed by the
 * sign-in provider.
 */
export function SettingsScreen({
  methods,
  identityResult,
  notificationPreferences = { documents: true },
}: {
  methods: SignInMethodView[];
  /** `?identity=` outcome from the link callback or a reauthentication. */
  identityResult?: string | null;
  notificationPreferences?: NotificationPreferences;
}) {
  const user = useSessionUser();
  return (
    <div className="space-y-6">
      <PageHeading
        title="Settings"
        description="Your profile, preferences and the ways you sign in."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Profile" contentClassName="space-y-4 pt-0">
          <div className="flex items-center gap-3">
            <UserAvatar user={user} className="size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{user.name}</p>
              <p className="text-sm text-muted-foreground">JPEG, PNG or WebP, up to 2 MB</p>
            </div>
            <AvatarUpload />
          </div>
          <ProfileForm displayName={user.name} />
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={user.email ?? "Not shared by your sign-in provider"}
              readOnly
              aria-describedby="email-help"
            />
            <p id="email-help" className="text-sm text-muted-foreground">
              Managed by your sign-in provider.
              {user.emailVerified ? null : " This address isn't verified yet."}
            </p>
          </div>
        </Panel>

        <Panel title="Preferences" contentClassName="space-y-5 pt-0">
          <ThemeSetting />
          <NotificationSettings initial={notificationPreferences} />
          <p className="text-sm">
            Your plan and usage are on{" "}
            <Link href="/dashboard/billing" className="text-link underline underline-offset-2">
              Billing and usage
            </Link>
            .
          </p>
        </Panel>

        <SignInMethodsPanel methods={methods} identityResult={identityResult ?? null} />

        <Panel title="Account" contentClassName="space-y-4 pt-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Sign out of FolioMind on this device.</p>
            <Button asChild variant="outline">
              <a href="/auth/logout">
                <LogOut aria-hidden="true" />
                Sign out
              </a>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/25 bg-error-bg p-4">
            <div>
              <p className="font-semibold text-error">Delete account</p>
              <p className="text-sm text-foreground/80">
                Permanently remove your account and private files.
              </p>
            </div>
            <ComingSoonButton variant="destructive" reason="Account deletion opens soon">
              <Trash2 aria-hidden="true" />
              Delete account
            </ComingSoonButton>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ProfileForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    mode: "onTouched",
    defaultValues: { displayName },
  });
  const error = form.formState.errors.displayName;

  async function onSubmit(values: ProfileFormValues) {
    setFormError(null);
    if (preview) return;
    const result = await updateProfile(values).catch(() => null);
    if (!result) {
      setFormError("We couldn't save your profile. Please try again.");
      return;
    }
    if (result.ok) {
      form.reset(result.data);
      toast.success("Profile saved.");
      router.refresh();
      return;
    }
    if (result.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    const message = result.fieldErrors?.displayName?.[0];
    if (message) form.setError("displayName", { message }, { shouldFocus: true });
    else setFormError(result.formError ?? "We couldn't save your profile. Please try again.");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-3">
      {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="display-name">Display name</FieldLabel>
        <Input
          id="display-name"
          autoComplete="name"
          maxLength={60}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "display-name-error" : "display-name-help"}
          {...form.register("displayName")}
        />
        {error ? (
          <FieldError id="display-name-error">{error.message}</FieldError>
        ) : (
          <FieldDescription id="display-name-help">
            Shown in your workspace. Up to 60 characters.
          </FieldDescription>
        )}
      </Field>
      <div>
        <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
          {form.formState.isSubmitting ? <Spinner aria-hidden="true" /> : null}
          Save profile
        </Button>
      </div>
    </form>
  );
}

/** Profile picture through UploadThing's public `avatarImage` route (Section 25). */
function AvatarUpload() {
  const router = useRouter();
  const preview = useIsPreview();
  const input = useRef<HTMLInputElement>(null);
  const { startUpload, isUploading } = useUploadThing("avatarImage", {
    onUploadError: (error) => {
      toast.error(error.data?.message ?? "We couldn't update your photo. Please try again.");
    },
  });

  async function upload(file: File | undefined) {
    if (!file || preview) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      toast.error("Choose a JPEG, PNG or WebP image up to 2 MB.");
      return;
    }
    const result = await startUpload([file]);
    if (result?.[0]?.serverData?.avatarUrl) {
      toast.success("Photo updated.");
      router.refresh();
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isUploading}
        onClick={() => input.current?.click()}
      >
        {isUploading ? <Spinner aria-hidden="true" /> : null}
        {isUploading ? "Uploading…" : "Change photo"}
      </Button>
    </>
  );
}

function ThemeSetting() {
  const { theme, choose } = usePersistedTheme();
  // next-themes reads storage on the client only; render the choice after hydration.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Appearance</legend>
      <RadioGroup
        value={mounted ? theme : undefined}
        onValueChange={(value) => void choose(value)}
        className="grid grid-cols-3 gap-2"
      >
        {options.map((option) => {
          const Icon = option.icon;
          const id = `theme-${option.value}`;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border px-3 py-3 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-subtle"
            >
              <Icon className="size-5" aria-hidden="true" />
              <span className="flex items-center gap-2">
                <RadioGroupItem id={id} value={option.value} />
                {option.label}
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

/**
 * In-app notifications only (push was dropped, 2026-11-04). Turning a group
 * off stops new notices of that kind; the setting saves at once.
 */
function NotificationSettings({ initial }: { initial: NotificationPreferences }) {
  const preview = useIsPreview();
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();

  const change = (key: NotificationPreferenceKey, checked: boolean) => {
    const previous = values;
    const next = { ...values, [key]: checked };
    setValues(next);
    if (preview) return;
    startTransition(async () => {
      const result = await updateNotificationPreferencesAction(next);
      if (!result.ok) {
        setValues(previous);
        if (result.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
        else toast.error(result.formError ?? "We couldn't save that. Try again.");
        return;
      }
      toast.success("Notification settings saved.");
    });
  };

  return (
    <fieldset className="space-y-3" disabled={pending}>
      <legend className="text-sm font-medium">Notifications</legend>
      {(Object.keys(NOTIFICATION_PREFERENCES) as NotificationPreferenceKey[]).map((key) => {
        const group = NOTIFICATION_PREFERENCES[key];
        return (
          <div key={key} className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor={`notify-${key}`} className="font-normal">
                {group.label}
              </Label>
              <p id={`notify-${key}-help`} className="text-sm text-muted-foreground">
                {group.description}
              </p>
            </div>
            <Switch
              id={`notify-${key}`}
              checked={values[key]}
              onCheckedChange={(checked) => change(key, checked)}
              aria-describedby={`notify-${key}-help`}
            />
          </div>
        );
      })}
      <p className="text-sm text-muted-foreground">
        Notifications appear under the bell at the top of the page.
      </p>
    </fieldset>
  );
}

const PROVIDER_ICONS: Record<SignInProvider, ReactNode> = {
  "google-oauth2": <GoogleMark className="size-5" />,
  github: <GitHubMark className="size-5 text-foreground" />,
};

function SignInMethodsPanel({
  methods,
  identityResult,
}: {
  methods: SignInMethodView[];
  identityResult: string | null;
}) {
  const user = useSessionUser();
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<{ tone: "error"; text: string } | null>(() => {
    const message = identityMessage(identityResult);
    return message && !isSuccess(identityResult) ? { tone: "error", text: message } : null;
  });
  const [needsReauth, setNeedsReauth] = useState(identityResult === "reauthentication_required");
  const shown = useRef(false);
  const primary = methods.find((method) => method.primary)?.provider;

  // The link callback reports its outcome once in the URL; toast a success, then drop it.
  useEffect(() => {
    if (shown.current || !identityResult) return;
    shown.current = true;
    const message = identityMessage(identityResult);
    if (message && isSuccess(identityResult)) toast.success(message);
    router.replace(pathname, { scroll: false });
  }, [identityResult, pathname, router]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Link2 className="size-5" aria-hidden="true" />
          Sign-in methods
        </span>
      }
      description="Connect another way to sign in to the same account."
      contentClassName="space-y-3 pt-0"
    >
      {notice ? <StatusAlert tone={notice.tone}>{notice.text}</StatusAlert> : null}
      {needsReauth && primary ? (
        <StatusAlert
          tone="warning"
          action={
            <Button asChild size="sm" variant="outline">
              <a
                href={loginHref({
                  connection: primary,
                  returnTo: "/dashboard/settings",
                  prompt: "login",
                })}
              >
                Sign in again
              </a>
            </Button>
          }
        >
          {identityMessage("reauthentication_required")}
        </StatusAlert>
      ) : null}
      {user.emailVerified ? null : (
        <StatusAlert tone="info">{identityMessage("email_unverified")}</StatusAlert>
      )}
      <ul className="divide-y rounded-lg border">
        {methods.map((method) => (
          <MethodRow
            key={method.provider}
            method={method}
            canConnect={user.emailVerified}
            onProblem={(text, code) => {
              if (code === "reauthentication_required") setNeedsReauth(true);
              else setNotice({ tone: "error", text });
            }}
          />
        ))}
      </ul>
    </Panel>
  );
}

function isSuccess(code: string | null): boolean {
  return (IDENTITY_SUCCESS_CODES as readonly string[]).includes(code ?? "");
}

function MethodRow({
  method,
  canConnect,
  onProblem,
}: {
  method: SignInMethodView;
  canConnect: boolean;
  onProblem: (message: string, code?: string) => void;
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const [pending, setPending] = useState(false);
  const name = SIGN_IN_PROVIDER_NAMES[method.provider];

  async function connect() {
    if (preview) return;
    setPending(true);
    const response = await fetch("/api/account/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connection: method.provider }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      redirectUrl?: string;
      error?: { code: string; message: string };
    } | null;
    if (response?.ok && body?.redirectUrl) {
      window.location.assign(body.redirectUrl);
      return;
    }
    setPending(false);
    if (response && handleRateLimitResponse(response)) return;
    onProblem(body?.error?.message ?? identityMessage("link_failed")!, body?.error?.code);
  }

  async function disconnect() {
    if (preview) return;
    setPending(true);
    const response = await fetch(`/api/account/identities/${method.provider}`, {
      method: "DELETE",
    }).catch(() => null);
    setPending(false);
    if (response?.ok) {
      toast.success(identityMessage("unlinked"));
      router.refresh();
      return;
    }
    if (response && handleRateLimitResponse(response)) return;
    const body = (await response?.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null;
    onProblem(body?.error?.message ?? identityMessage("link_failed")!, body?.error?.code);
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {PROVIDER_ICONS[method.provider]}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {name}
          {method.connected ? <Badge variant="success">Connected</Badge> : null}
          {method.primary ? <Badge variant="soft">Primary</Badge> : null}
        </p>
        {method.email ? (
          <p className="truncate text-sm text-muted-foreground">{method.email}</p>
        ) : null}
      </div>
      {!method.connected ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void connect()}
          disabled={pending || !canConnect}
        >
          {pending ? <Spinner aria-hidden="true" /> : null}
          Connect {name}
        </Button>
      ) : method.primary ? null : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={pending}>
              {pending ? <Spinner aria-hidden="true" /> : null}
              Disconnect
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                You won&apos;t be able to sign in with {name} until you connect it again. Your
                account and everything in it stay the same.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => void disconnect()}>Disconnect</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}
