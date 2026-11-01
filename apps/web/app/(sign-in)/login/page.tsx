import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInPanel } from "@/components/foliomind/sign-in-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { safeReturnTo } from "@/lib/auth/return-to";
import { signInErrorMessage } from "@/lib/auth/sign-in-errors";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to FolioMind with Google, GitHub or your email.",
  robots: { index: false },
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="space-y-7">
      <div className="space-y-2 text-center">
        <h1 className="font-serif text-[2rem]/tight font-semibold tracking-[-0.01em]">
          Welcome to FolioMind
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          Sign in to save books, upload PDFs and ask cited questions.{" "}
          <span className="font-medium text-foreground">
            New here? Any option below creates your free account.
          </span>
        </p>
      </div>
      <Suspense fallback={<PanelSkeleton />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(first(params.returnTo));
  if (await getSessionUser()) redirect(returnTo);
  return <SignInPanel returnTo={returnTo} error={signInErrorMessage(first(params.auth_error))} />;
}

function PanelSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading sign-in options">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="mt-4 h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
