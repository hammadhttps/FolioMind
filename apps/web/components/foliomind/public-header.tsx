import { Suspense } from "react";
import { Logo } from "@/components/icons/logo";
import { getSessionUser } from "@/lib/session";
import { GuestActions, MemberActions, PublicNav, PublicNavLinks } from "./public-nav";

/**
 * Guest header (blueprint Section 5): logo, Explore, Pricing, Sign in and Get
 * started. The session read streams in; guests see the prerendered actions.
 */
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur-md supports-backdrop-filter:bg-card/75">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-[15px] sm:gap-4 sm:px-[18px] md:h-[72px] md:gap-8 md:px-[25px] xl:px-9">
        <Logo size="header" href="/" />
        <Suspense fallback={<PublicNavLinks />}>
          <PublicNav />
        </Suspense>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Suspense fallback={<GuestActions />}>
            <HeaderActions />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function HeaderActions() {
  const user = await getSessionUser();
  return user ? <MemberActions /> : <GuestActions />;
}
