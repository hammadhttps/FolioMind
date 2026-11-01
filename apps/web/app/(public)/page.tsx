import { LayoutDashboard } from "lucide-react";
import { Suspense } from "react";
import { heroPrimaryClass, HeroLink } from "@/components/foliomind/hero";
import { HomeScreen } from "@/components/foliomind/screens/home";
import { SessionSwitch } from "@/components/foliomind/session-switch";
import { SignInDialog } from "@/components/foliomind/sign-in-dialog";

export default function HomePage() {
  const getStarted = (
    <SignInDialog returnTo="/dashboard">
      <button type="button" className={heroPrimaryClass}>
        Get started
      </button>
    </SignInDialog>
  );

  return (
    <HomeScreen
      primaryAction={
        <Suspense fallback={getStarted}>
          <SessionSwitch
            signedOut={getStarted}
            signedIn={
              <HeroLink href="/dashboard">
                <LayoutDashboard aria-hidden="true" />
                Go to your dashboard
              </HeroLink>
            }
          />
        </Suspense>
      }
    />
  );
}
