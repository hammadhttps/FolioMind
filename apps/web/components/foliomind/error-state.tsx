"use client";

import { CircleX, RotateCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

/** Route error view in the Section 20 tone; never shows stack traces or provider messages. */
export function ErrorState({ reset, homeHref = "/" }: { reset?: () => void; homeHref?: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-[15px] py-16">
      <EmptyState
        icon={CircleX}
        title="Something went wrong on our side."
        description="Please try again. If it keeps happening, come back in a little while."
        actions={
          <>
            {reset ? (
              <Button onClick={reset}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={homeHref}>
                {homeHref === "/" ? "Go to the home page" : "Back to dashboard"}
              </Link>
            </Button>
          </>
        }
      />
    </div>
  );
}
