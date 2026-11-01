import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * The fixed pale-lavender editorial hero (Section 19). Its colors are
 * intentionally the same in light and dark themes, including the dark-indigo
 * primary action, so they are raw values rather than theme tokens.
 */
const HERO_INK = "text-[#20243E]";
const HERO_SUPPORT = "text-[#5C627C]";

interface HeroProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** "home" is the spacious landing hero; "dashboard" is the compact workspace hero. */
  size?: "home" | "dashboard";
  /** Heading level: the Home hero holds the page's h1; the Dashboard hero is an h2. */
  as?: "h1" | "h2";
  className?: string;
}

export function Hero({
  eyebrow,
  title,
  description,
  actions,
  size = "home",
  as: Heading = "h1",
  className,
}: HeroProps) {
  const home = size === "home";
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-[#20243E]/8 bg-[linear-gradient(135deg,#F0F0FE_0%,#F5F5FC_48%,#E9EAF9_100%)]",
        home ? "px-6 py-12 sm:px-10 md:py-16 xl:px-14 xl:py-20" : "px-6 py-8 sm:px-8 md:py-10",
        className,
      )}
    >
      <HeroIllustration
        className={cn(
          "pointer-events-none absolute -z-10 max-sm:opacity-20",
          home
            ? "top-1/2 right-[-6%] w-[min(48%,520px)] -translate-y-1/2 max-md:right-[-25%] max-md:w-[80%] max-md:opacity-30"
            : "top-1/2 right-[-2%] w-[min(38%,360px)] -translate-y-1/2 max-md:right-[-20%] max-md:w-[70%] max-md:opacity-30",
        )}
      />
      <div
        className={cn(
          "relative max-w-[min(100%,620px)]",
          home ? "md:max-w-[56%]" : "md:max-w-[60%]",
        )}
      >
        {eyebrow ? (
          <p className={cn("mb-4 text-xs font-semibold tracking-[0.16em] uppercase", HERO_SUPPORT)}>
            {eyebrow}
          </p>
        ) : null}
        <Heading
          className={cn(
            "font-serif font-semibold tracking-[-0.015em] text-balance",
            HERO_INK,
            home
              ? "text-[2.375rem]/[1.08] sm:text-5xl/[1.06] xl:text-[3.25rem]/[1.05]"
              : "text-[1.75rem]/tight md:text-[2.125rem]/tight",
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p
            className={cn(
              "mt-4 max-w-xl",
              HERO_SUPPORT,
              home ? "text-lg/relaxed" : "text-base/relaxed",
            )}
          >
            {description}
          </p>
        ) : null}
        {actions ? (
          <div className={cn("flex flex-wrap gap-3", home ? "mt-8" : "mt-6")}>{actions}</div>
        ) : null}
      </div>
    </section>
  );
}

const heroButtonBase =
  "inline-flex h-11 items-center justify-center gap-2 rounded-button px-5 text-[0.9375rem] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-[#4338CA]/40 [&_svg]:size-4";

/** Dark-indigo primary in both themes (Section 19). */
export const heroPrimaryClass = cn(
  heroButtonBase,
  "bg-[#4338CA] text-white hover:bg-[#3730A3] active:bg-[#312E81]",
);
export const heroSecondaryClass = cn(
  heroButtonBase,
  "border border-[#20243E]/15 bg-white/70 text-[#20243E] hover:bg-white",
);

export function HeroLink({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  return (
    <Link href={href} className={variant === "primary" ? heroPrimaryClass : heroSecondaryClass}>
      {children}
    </Link>
  );
}

/**
 * Inline vector illustration: an open book resting on stacked books, faint
 * circular guides and restrained sparkles (Section 19). No stock photography.
 */
export function HeroIllustration({ className }: { className?: string }) {
  const spark =
    "M16 4.25c.42 2.5 1.75 3.83 4.25 4.25-2.5.42-3.83 1.75-4.25 4.25-.42-2.5-1.75-3.83-4.25-4.25 2.5-.42 3.83-1.75 4.25-4.25z";
  return (
    <svg
      viewBox="0 0 460 340"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="236" cy="168" r="150" stroke="#4338CA" strokeOpacity="0.1" strokeWidth="1.5" />
      <circle
        cx="236"
        cy="168"
        r="108"
        stroke="#4338CA"
        strokeOpacity="0.12"
        strokeWidth="1.5"
        strokeDasharray="3 7"
      />
      <circle cx="236" cy="168" r="196" stroke="#4338CA" strokeOpacity="0.06" strokeWidth="1.5" />
      <ellipse cx="236" cy="292" rx="150" ry="9" fill="#20243E" fillOpacity="0.08" />

      {/* Stacked books */}
      <g>
        <rect x="138" y="262" width="200" height="26" rx="4" fill="#2A506C" />
        <rect x="318" y="266" width="14" height="18" rx="2" fill="#F3EBDD" />
        <rect x="158" y="262" width="6" height="26" fill="#FFFFFF" fillOpacity="0.16" />
      </g>
      <g>
        <rect x="118" y="234" width="236" height="28" rx="4" fill="#984B42" />
        <rect x="334" y="238" width="14" height="20" rx="2" fill="#F3EBDD" />
        <rect x="140" y="234" width="6" height="28" fill="#FFFFFF" fillOpacity="0.16" />
        <rect x="186" y="244" width="96" height="3" rx="1.5" fill="#FFFFFF" fillOpacity="0.3" />
      </g>
      <g>
        <rect x="132" y="210" width="212" height="24" rx="4" fill="#284D42" />
        <rect x="324" y="214" width="14" height="16" rx="2" fill="#F3EBDD" />
        <rect x="152" y="210" width="6" height="24" fill="#FFFFFF" fillOpacity="0.16" />
      </g>

      {/* Open book */}
      <path
        d="M236 210c-30-17-74-21-122-13V125c48-8 92-4 122 13 30-17 74-21 122-13v72c-48-8-92-4-122 13z"
        fill="#4338CA"
      />
      <path d="M236 132c-27-16-66-20-110-13v68c44-7 83-3 110 13z" fill="#FFFCF5" />
      <path d="M236 132c27-16 66-20 110-13v68c-44-7-83-3-110 13z" fill="#F4F2FB" />
      <path d="M236 132v68" stroke="#20243E" strokeOpacity="0.18" strokeWidth="1.5" />
      <g stroke="#5C627C" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round">
        <path d="M146 136c25-3 46-1 70 7" />
        <path d="M146 150c25-3 46-1 70 7" />
        <path d="M146 164c25-3 46-1 70 7" />
        <path d="M146 178c17-2 30-1 44 3" />
        <path d="M256 143c24-8 45-10 70-7" />
        <path d="M256 157c24-8 45-10 70-7" />
        <path d="M256 171c24-8 45-10 70-7" />
      </g>
      <path
        d="M268 182c14-5 28-6 42-5"
        stroke="#0F766E"
        strokeOpacity="0.55"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Sparkles */}
      <path d={spark} fill="#E9A23B" transform="translate(328 34) scale(2.3)" />
      <path d={spark} fill="#4338CA" fillOpacity="0.55" transform="translate(84 76) scale(1.3)" />
      <path d={spark} fill="#4338CA" fillOpacity="0.35" transform="translate(384 150) scale(1)" />
    </svg>
  );
}
