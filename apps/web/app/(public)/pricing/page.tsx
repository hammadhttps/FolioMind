import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/foliomind/public-page";
import { PricingScreen } from "@/components/foliomind/screens/pricing";
import { SessionSwitch } from "@/components/foliomind/session-switch";
import { SignInDialog } from "@/components/foliomind/sign-in-dialog";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Compare FolioMind Free and FolioMind Pro.",
};

export default function PricingPage() {
  const startFree = (
    <SignInDialog returnTo="/dashboard">
      <Button size="lg" variant="outline" className="w-full">
        Get started free
      </Button>
    </SignInDialog>
  );

  return (
    <PublicPage>
      <PricingScreen
        freeAction={
          <Suspense fallback={startFree}>
            <SessionSwitch
              signedOut={startFree}
              signedIn={
                <Button asChild size="lg" variant="outline" className="w-full">
                  <Link href="/dashboard">Go to your dashboard</Link>
                </Button>
              }
            />
          </Suspense>
        }
      />
    </PublicPage>
  );
}
