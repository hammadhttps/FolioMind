import { Compass } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/foliomind/empty-state";
import { PublicFooter } from "@/components/foliomind/public-footer";
import { PublicHeader } from "@/components/foliomind/public-header";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-2xl flex-1 items-center px-[15px] py-16 outline-none"
      >
        <EmptyState
          icon={Compass}
          title="We couldn't find that page."
          description="It may have moved, or the link might be incomplete."
          actions={
            <>
              <Button asChild>
                <Link href="/">Go to the home page</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/library">Explore the library</Link>
              </Button>
            </>
          }
        />
      </main>
      <PublicFooter />
    </div>
  );
}
