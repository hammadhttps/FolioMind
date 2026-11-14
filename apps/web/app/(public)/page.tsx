import { LayoutDashboard } from "lucide-react";
import { connection } from "next/server";
import { Suspense } from "react";
import { FeaturedBooks } from "@/components/foliomind/catalog/featured-books";
import { heroPrimaryClass, HeroLink } from "@/components/foliomind/hero";
import { HomeScreen } from "@/components/foliomind/screens/home";
import { SessionSwitch } from "@/components/foliomind/session-switch";
import { SignInDialog } from "@/components/foliomind/sign-in-dialog";
import { loadFeaturedBooks } from "@/lib/catalog/data";

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
      featured={
        <Suspense fallback={null}>
          <Featured />
        </Suspense>
      }
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

/** Read at request time (not at build), then cached under the `catalog` tag. */
async function Featured() {
  await connection();
  const books = await loadFeaturedBooks().catch((error: unknown) => {
    // Home must render even if the catalog can't be read right now.
    console.error(JSON.stringify({ event: "home.featured_failed", name: (error as Error)?.name }));
    return [];
  });
  return <FeaturedBooks books={books} />;
}
