import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page heading row (Section 19): title, supporting line and right-aligned
 * actions; actions stack under the text at 460px and below. A page has one
 * `h1`; headings of tabs or sections inside it use `as="h2"`.
 */
export function PageHeading({
  title,
  description,
  actions,
  eyebrow,
  as: Heading = "h1",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <Heading className="text-[1.75rem]/tight font-semibold tracking-[-0.015em] text-balance md:text-[1.875rem]">
          {title}
        </Heading>
        {description ? (
          <p className="max-w-2xl text-base text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
