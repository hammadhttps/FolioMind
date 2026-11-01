"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { GitHubMark, GoogleMark } from "@/components/icons/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { loginHref, type SignInConnection } from "@/lib/auth/return-to";
import { StatusAlert } from "./status-alert";

// Stores only the connection name, to show a "Last used" hint (Section 22).
const LAST_USED_COOKIE = "fm_last_signin";
const CONNECTIONS: readonly SignInConnection[] = ["google-oauth2", "github"];

function readLastUsed(): SignInConnection | null {
  const value = document.cookie.match(new RegExp(`(?:^|; )${LAST_USED_COOKIE}=([^;]+)`))?.[1];
  return CONNECTIONS.find((connection) => connection === value) ?? null;
}

function rememberLastUsed(connection: SignInConnection) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LAST_USED_COOKIE}=${connection}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
}

const noopSubscribe = () => () => {};

/**
 * FolioMind's sign-in screen (Section 22, adapted): Google and GitHub go
 * straight to the provider, and the first sign-in creates the account. Auth0's
 * hosted login page is never shown. Used by the sign-in dialog and the /login
 * page.
 */
export function SignInPanel({ returnTo, error }: { returnTo: string; error?: string | null }) {
  const [pending, setPending] = useState<SignInConnection | null>(null);
  const lastUsed = useSyncExternalStore(noopSubscribe, readLastUsed, () => null);

  function choose(connection: SignInConnection) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      // One redirect at a time: later clicks are ignored while the first loads.
      if (pending) {
        event.preventDefault();
        return;
      }
      setPending(connection);
      rememberLastUsed(connection);
    };
  }

  return (
    <div className="grid gap-5">
      {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}

      <div className="grid gap-3">
        <SocialButton
          href={loginHref({ returnTo, connection: "google-oauth2" })}
          icon={<GoogleMark className="size-5" />}
          label="Continue with Google"
          pending={pending === "google-oauth2"}
          blocked={pending !== null && pending !== "google-oauth2"}
          lastUsed={lastUsed === "google-oauth2"}
          onClick={choose("google-oauth2")}
        />
        <SocialButton
          href={loginHref({ returnTo, connection: "github" })}
          icon={<GitHubMark className="size-5 text-foreground" />}
          label="Continue with GitHub"
          pending={pending === "github"}
          blocked={pending !== null && pending !== "github"}
          lastUsed={lastUsed === "github"}
          onClick={choose("github")}
        />
      </div>

      <p className="text-center text-xs/relaxed text-muted-foreground">
        By continuing you agree to the{" "}
        <Link href="/terms" className="text-link underline underline-offset-2">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-link underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}

function SocialButton({
  href,
  icon,
  label,
  pending,
  blocked,
  lastUsed,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  pending: boolean;
  blocked: boolean;
  lastUsed: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Button asChild variant="outline" size="lg" className="relative min-h-11 w-full font-medium">
      {/* A full page load: /auth/login is served by the Auth0 proxy, not a page. */}
      <a
        href={href}
        onClick={onClick}
        aria-disabled={blocked || undefined}
        aria-busy={pending || undefined}
      >
        {pending ? <Spinner className="size-5" /> : icon}
        <span>{pending ? "Redirecting…" : label}</span>
        {lastUsed && !pending ? (
          <Badge variant="soft" className="absolute right-3 max-sm:hidden">
            Last used
          </Badge>
        ) : null}
      </a>
    </Button>
  );
}
