import { PLAN_LIMITS } from "@foliomind/contracts";
import { planLimits } from "@foliomind/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/foliomind/public-page";
import { PricingScreen, type PricingData } from "@/components/foliomind/screens/pricing";
import { SignInDialog } from "@/components/foliomind/sign-in-dialog";
import { formatPrice, getProPrice, isSandbox } from "@/lib/billing/server";
import { getDb } from "@/lib/clients";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Compare FolioMind Free and FolioMind Pro.",
};

const startFree = (
  <SignInDialog returnTo="/dashboard">
    <Button size="lg" variant="outline" className="w-full">
      Get started free
    </Button>
  </SignInDialog>
);

/** Shown while the real configuration loads: the provisional limits and no price. */
const FALLBACK: PricingData = {
  limits: PLAN_LIMITS,
  priceLabel: null,
  sandbox: true,
  viewer: { signedIn: false, planCode: null },
};

export default function PricingPage({ searchParams }: PageProps<"/pricing">) {
  return (
    <PublicPage>
      <Suspense fallback={<PricingScreen data={FALLBACK} freeAction={startFree} />}>
        <Pricing searchParams={searchParams} />
      </Suspense>
    </PublicPage>
  );
}

/** Real plans, Stripe's price and the viewer's plan, read at request time. */
async function Pricing({ searchParams }: Pick<PageProps<"/pricing">, "searchParams">) {
  await connection();
  const db = getDb();
  const [free, pro, price, user, params] = await Promise.all([
    planLimits(db, "free"),
    planLimits(db, "pro"),
    getProPrice(),
    getSessionUser(),
    searchParams,
  ]);
  const signedIn = Boolean(user);
  return (
    <PricingScreen
      data={{
        limits: { free, pro },
        priceLabel: price ? formatPrice(price) : null,
        sandbox: price ? !price.livemode : isSandbox(),
        viewer: { signedIn, planCode: user?.planCode ?? null },
        checkoutCancelled: params.checkout === "cancelled",
      }}
      freeAction={
        signedIn ? (
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
        ) : (
          startFree
        )
      }
    />
  );
}
