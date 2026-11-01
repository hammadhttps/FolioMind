"use client";

import { Link2, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";
import { GitHubMark, GoogleMark } from "@/components/icons/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { useSessionUser } from "../session-user";
import { UserAvatar } from "../user-avatar";

const noopSubscribe = () => () => {};

/**
 * Account Settings (Section 20 #13). Theme works now; profile editing,
 * notification preferences and sign-in methods are wired in Phases 4 and 6, and
 * account deletion in Phase 10. Identity fields are managed by Auth0.
 */
export function SettingsScreen() {
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
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name}</p>
              <p className="text-sm text-muted-foreground">Photo from your sign-in provider</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" defaultValue={user.name} disabled maxLength={60} />
            <p className="text-sm text-muted-foreground">Editing your profile opens soon.</p>
          </div>
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
            </p>
          </div>
        </Panel>

        <Panel title="Preferences" contentClassName="space-y-5 pt-0">
          <ThemeSetting />
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Notifications</legend>
            <SwitchRow id="notify-ready" label="A document is ready to read" />
            <SwitchRow id="notify-project" label="A project draft or export is ready" />
            <SwitchRow id="notify-push" label="Browser notifications on this device" />
            <p className="text-sm text-muted-foreground">Notification settings open soon.</p>
          </fieldset>
          <p className="text-sm">
            Your plan and usage are on{" "}
            <Link href="/dashboard/billing" className="text-link underline underline-offset-2">
              Billing and usage
            </Link>
            .
          </p>
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Link2 className="size-5" aria-hidden="true" />
              Sign-in methods
            </span>
          }
          description="Connect another way to sign in to the same account."
          contentClassName="pt-0"
        >
          <ul className="divide-y rounded-lg border">
            <MethodRow icon={<GoogleMark className="size-5" />} name="Google" />
            <MethodRow icon={<GitHubMark className="size-5 text-foreground" />} name="GitHub" />
          </ul>
        </Panel>

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

function ThemeSetting() {
  const { theme, setTheme } = useTheme();
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
        onValueChange={setTheme}
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

function SwitchRow({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} disabled />
    </div>
  );
}

function MethodRow({ icon, name }: { icon: ReactNode; name: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {icon}
      <span className="flex-1 font-medium">{name}</span>
      <ComingSoonButton size="sm" variant="outline" reason="Connecting sign-in methods opens soon">
        Connect
      </ComingSoonButton>
    </li>
  );
}
