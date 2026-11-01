import Link from "next/link";
import type { ReactNode } from "react";
import { HeroIllustration } from "@/components/foliomind/hero";
import { Logo } from "@/components/icons/logo";

/*
 * FolioMind's own sign-in screen (replaces Auth0's hosted page): the fixed
 * lavender brand panel from Section 19 on wide screens, the theme-aware sign-in
 * card on the canvas.
 */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative isolate hidden flex-col justify-between overflow-hidden bg-[linear-gradient(135deg,#F0F0FE_0%,#F5F5FC_48%,#E9EAF9_100%)] p-10 lg:flex xl:p-14">
        <Logo size="header" href="/" tone="hero" className="self-start" />
        <HeroIllustration className="mx-auto w-full max-w-[520px]" />
        <div className="space-y-3">
          <p className="font-serif text-[2.25rem]/[1.1] font-semibold tracking-[-0.015em] text-balance text-[#20243E] xl:text-[2.625rem]/[1.08]">
            Read deeply. Connect freely. Create thoughtfully.
          </p>
          <p className="max-w-md text-base/relaxed text-[#5C627C]">
            Your library, cited answers and polished PDFs, all in one calm workspace.
          </p>
        </div>
      </aside>

      <div className="flex min-h-svh flex-col">
        <header className="flex items-center justify-between px-[15px] pt-5 sm:px-[25px] lg:justify-end">
          <Logo size="header" href="/" className="lg:hidden" />
          <Link
            href="/"
            className="rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/70"
          >
            Back to home
          </Link>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 items-center justify-center px-[15px] py-10 outline-none sm:px-[25px]"
        >
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
