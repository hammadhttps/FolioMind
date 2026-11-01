import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/foliomind/app-shell";
import { AppShellSkeleton } from "@/components/foliomind/app-shell-skeleton";
import { requireSessionUser } from "@/lib/session";

/*
 * Signed-in workspace (blueprint Section 19). The proxy already sends guests to
 * sign-in with a return path; the session read here streams behind Suspense so
 * the shell skeleton is the prerendered part, never the page content.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <SignedInShell>{children}</SignedInShell>
    </Suspense>
  );
}

async function SignedInShell({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  return <AppShell user={user}>{children}</AppShell>;
}
