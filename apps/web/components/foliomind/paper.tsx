import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Warm paper surface (Section 19): the same #FFFCF5 paper and dark ink in both
 * themes, with Source Serif reading text. For generated documents and reader
 * previews only; uploaded PDFs are never recolored.
 */
export function Paper({
  children,
  runningHead,
  pageNumber,
  className,
}: {
  children: ReactNode;
  runningHead?: string;
  pageNumber?: number | string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[720px] rounded-[3px] bg-paper px-[8%] py-10 font-serif text-[1.0625rem]/[1.75] text-paper-ink shadow-[0_1px_2px_rgb(15_23_42/0.1),0_10px_30px_-12px_rgb(15_23_42/0.25)] md:py-14 md:text-lg/[1.75]",
        className,
      )}
    >
      {runningHead ? (
        <p className="mb-8 font-sans text-xs font-medium tracking-[0.14em] text-paper-ink/60 uppercase">
          {runningHead}
        </p>
      ) : null}
      {children}
      {pageNumber !== undefined ? (
        <p className="mt-10 text-center font-sans text-xs text-paper-ink/60 tabular-nums">
          {pageNumber}
        </p>
      ) : null}
    </div>
  );
}
