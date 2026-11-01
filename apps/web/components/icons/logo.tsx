import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * FolioMind line mark (assets/brand/logo-mark.svg) drawn with currentColor, so
 * it is indigo in light mode and #A5B4FC in dark mode via `text-primary`.
 */
export function LogoMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M16 3.5c.42 2.5 1.75 3.83 4.25 4.25-2.5.42-3.83 1.75-4.25 4.25-.42-2.5-1.75-3.83-4.25-4.25 2.5-.42 3.83-1.75 4.25-4.25z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M16 16c-2.6-1.7-5.7-2.3-9.5-2v12c3.8-.3 6.9.3 9.5 2 2.6-1.7 5.7-2.3 9.5-2V14c-3.8-.3-6.9.3-9.5 2z" />
      <path d="M16 16v12" />
    </svg>
  );
}

const lockupSizes = {
  // Sidebar: 24px mark; public header: 28px mark (Section 30), the sidebar size at 460px and below.
  sidebar: { mark: "size-6", word: "text-[1.375rem]" },
  header: { mark: "size-6 sm:size-7", word: "text-[1.25rem] sm:text-[1.625rem]" },
} as const;

interface LogoProps {
  size?: keyof typeof lockupSizes;
  href?: string;
  /** "hero" keeps indigo and dark ink on the fixed lavender surfaces in both themes. */
  tone?: "default" | "hero";
  className?: string;
}

/** Line mark plus the Inter 700 "FolioMind" wordmark, 8px apart. */
export function Logo({ size = "sidebar", href = "/", tone = "default", className }: LogoProps) {
  const sizes = lockupSizes[size];
  const hero = tone === "hero";
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-button outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
        className,
      )}
    >
      <LogoMark className={cn(sizes.mark, hero ? "text-[#4338CA]" : "text-primary")} />
      <span
        className={cn(
          "leading-none font-bold tracking-[-0.02em]",
          hero ? "text-[#20243E]" : "text-foreground",
          sizes.word,
        )}
      >
        FolioMind
      </span>
    </Link>
  );
}
