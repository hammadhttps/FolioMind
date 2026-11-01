"use client";

import { emailSignInStartSchema, emailSignInVerifySchema } from "@foliomind/contracts/forms";
import type { ActionResult } from "@foliomind/contracts/forms";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { useForm, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { GitHubMark, GoogleMark } from "@/components/icons/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { startEmailSignIn, verifyEmailCode } from "@/lib/auth/email-sign-in";
import { loginHref, type SignInConnection } from "@/lib/auth/return-to";
import { cn } from "@/lib/utils";
import { StatusAlert } from "./status-alert";

type Method = SignInConnection | "email";

// Stores only the method name, to show a "Last used" hint (Section 22).
const LAST_USED_COOKIE = "fm_last_signin";
const METHODS: readonly Method[] = ["google-oauth2", "github", "email"];
const RESEND_AFTER_MS = 30_000;
const codeOnlySchema = emailSignInVerifySchema.pick({ code: true });

function readLastUsed(): Method | null {
  const value = document.cookie.match(new RegExp(`(?:^|; )${LAST_USED_COOKIE}=([^;]+)`))?.[1];
  return METHODS.find((method) => method === value) ?? null;
}

function rememberLastUsed(method: Method) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LAST_USED_COOKIE}=${method}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
}

const noopSubscribe = () => () => {};

/** Maps a Server Action failure onto the form (field messages and a form-level message). */
function applyResult<T extends FieldValues>(
  form: UseFormReturn<T>,
  result: Extract<ActionResult, { ok: false }>,
) {
  let focused = false;
  for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
    if (!messages?.[0]) continue;
    form.setError(field as Path<T>, { message: messages[0] }, { shouldFocus: !focused });
    focused = true;
  }
  if (result.formError) form.setError("root", { message: result.formError });
}

/**
 * FolioMind's sign-in screen (Section 22, adapted): Google and GitHub go
 * straight to the provider; email sign-in sends a 6-digit code that is entered
 * here. Auth0's hosted login page is never shown. Used by the sign-in dialog
 * and the /login page.
 */
export function SignInPanel({ returnTo, error }: { returnTo: string; error?: string | null }) {
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [pendingSocial, setPendingSocial] = useState<SignInConnection | null>(null);
  const lastUsed = useSyncExternalStore(noopSubscribe, readLastUsed, () => null);

  function chooseSocial(connection: SignInConnection) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      // One redirect at a time: later clicks are ignored while the first loads.
      if (pendingSocial) {
        event.preventDefault();
        return;
      }
      setPendingSocial(connection);
      rememberLastUsed(connection);
    };
  }

  return (
    <div className="grid gap-5">
      {error ? <StatusAlert tone="error">{error}</StatusAlert> : null}

      {codeFor ? (
        <EmailCodeStep email={codeFor} returnTo={returnTo} onBack={() => setCodeFor(null)} />
      ) : (
        <>
          <div className="grid gap-3">
            <SocialButton
              href={loginHref({ returnTo, connection: "google-oauth2" })}
              icon={<GoogleMark className="size-5" />}
              label="Continue with Google"
              pending={pendingSocial === "google-oauth2"}
              blocked={pendingSocial !== null && pendingSocial !== "google-oauth2"}
              lastUsed={lastUsed === "google-oauth2"}
              onClick={chooseSocial("google-oauth2")}
            />
            <SocialButton
              href={loginHref({ returnTo, connection: "github" })}
              icon={<GitHubMark className="size-5 text-foreground" />}
              label="Continue with GitHub"
              pending={pendingSocial === "github"}
              blocked={pendingSocial !== null && pendingSocial !== "github"}
              lastUsed={lastUsed === "github"}
              onClick={chooseSocial("github")}
            />
          </div>

          <div className="flex items-center gap-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or use your email
            <span className="h-px flex-1 bg-border" />
          </div>

          <EmailStartStep
            lastUsed={lastUsed === "email"}
            onSent={(email) => {
              rememberLastUsed("email");
              setCodeFor(email);
            }}
          />
        </>
      )}

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

function EmailStartStep({
  lastUsed,
  onSent,
}: {
  lastUsed: boolean;
  onSent: (email: string) => void;
}) {
  const form = useForm({
    resolver: zodResolver(emailSignInStartSchema),
    mode: "onTouched",
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await startEmailSignIn(values);
    if (result.ok) onSent(values.email);
    else applyResult(form, result);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3" aria-label="Sign in with email">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="sign-in-email">Email address</Label>
          {lastUsed ? <Badge variant="soft">Last used</Badge> : null}
        </div>
        <Input
          id="sign-in-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "sign-in-email-error" : undefined}
          className="h-11"
          {...form.register("email")}
        />
        {errors.email ? (
          <p id="sign-in-email-error" className="text-sm text-error">
            {errors.email.message}
          </p>
        ) : null}
      </div>
      {errors.root ? <StatusAlert tone="error">{errors.root.message}</StatusAlert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? <Spinner className="size-5" /> : <Mail aria-hidden="true" />}
        {isSubmitting ? "Sending your code…" : "Email me a sign-in code"}
      </Button>
    </form>
  );
}

function EmailCodeStep({
  email,
  returnTo,
  onBack,
}: {
  email: string;
  returnTo: string;
  onBack: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(codeOnlySchema),
    mode: "onSubmit",
    defaultValues: { code: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const [redirecting, setRedirecting] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_AFTER_MS);
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const onSubmit = form.handleSubmit(async ({ code }) => {
    const result = await verifyEmailCode({ email, code });
    if (result.ok) {
      setRedirecting(true);
      // A full navigation, so every server component sees the new session.
      window.location.assign(returnTo);
    } else {
      applyResult(form, result);
    }
  });

  async function resend() {
    setResending(true);
    const result = await startEmailSignIn({ email });
    setResending(false);
    if (result.ok) {
      form.clearErrors();
      setResendAt(Date.now() + RESEND_AFTER_MS);
      toast.success("We sent a new code.");
    } else if (result.formError) {
      form.setError("root", { message: result.formError });
    }
  }

  const busy = isSubmitting || redirecting;
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-4"
      aria-label="Enter your sign-in code"
    >
      <div className="space-y-1" aria-live="polite">
        <p className="font-semibold">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to{" "}
          <span className="font-medium break-all text-foreground">{email}</span>. Enter it below to
          finish signing in.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sign-in-code">6-digit code</Label>
        <Input
          id="sign-in-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          placeholder="123456"
          aria-invalid={errors.code ? true : undefined}
          aria-describedby={errors.code ? "sign-in-code-error" : undefined}
          className="h-12 text-center font-mono text-xl tracking-[0.5em] placeholder:tracking-[0.5em]"
          {...form.register("code")}
        />
        {errors.code ? (
          <p id="sign-in-code-error" className="text-sm text-error">
            {errors.code.message}
          </p>
        ) : null}
      </div>
      {errors.root ? <StatusAlert tone="error">{errors.root.message}</StatusAlert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? <Spinner className="size-5" /> : null}
        {redirecting ? "Signing you in…" : isSubmitting ? "Checking your code…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={busy}
          className="-ml-2"
        >
          <ArrowLeft aria-hidden="true" />
          Use a different email
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={resend}
          disabled={busy || resending || waitSeconds > 0}
          className={cn(waitSeconds > 0 && "text-muted-foreground")}
        >
          {resending
            ? "Sending…"
            : waitSeconds > 0
              ? `Send a new code in ${waitSeconds}s`
              : "Send a new code"}
        </Button>
      </div>
    </form>
  );
}
