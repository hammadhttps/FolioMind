import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Content container for guest pages: 1600px max width with Section 19 gutters. */
export function PublicPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1600px] px-[15px] py-6 sm:px-[18px] md:px-[25px] md:py-10 xl:px-9",
        className,
      )}
    >
      {children}
    </div>
  );
}
