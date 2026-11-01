import { cn } from "@/lib/utils";

/*
 * CSS cover art for books and documents without an uploaded cover (Sections 19
 * and 25): muted sage, sand, lilac, deep blue, terracotta and ink, chosen
 * deterministically from the item ID so a book always keeps its colors.
 */
export const COVER_VARIANTS = {
  sage: { background: "#284D42", ink: "#F3EFE4" },
  sand: { background: "#DECCAA", ink: "#2B2A26" },
  lilac: { background: "#504C78", ink: "#F1EEFB" },
  deepBlue: { background: "#2A506C", ink: "#EEF4F8" },
  terracotta: { background: "#984B42", ink: "#FBF0EA" },
  ink: { background: "#30344C", ink: "#EEF0F8" },
} as const;

export type CoverVariant = keyof typeof COVER_VARIANTS;
const VARIANT_NAMES = Object.keys(COVER_VARIANTS) as CoverVariant[];

/** FNV-1a hash of the ID, mapped onto the six variants. */
export function coverVariantFor(id: string): CoverVariant {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return VARIANT_NAMES[(hash >>> 0) % VARIANT_NAMES.length] ?? "ink";
}

interface BookCoverProps {
  id: string;
  title: string;
  author?: string | null;
  /** Small label at the top, such as the edition or publisher. */
  label?: string | null;
  /** Decorative when the title is also shown as text next to the cover. */
  decorative?: boolean;
  className?: string;
}

export function BookCover({
  id,
  title,
  author,
  label,
  decorative = true,
  className,
}: BookCoverProps) {
  const variant = COVER_VARIANTS[coverVariantFor(id)];
  return (
    <div
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `Cover of ${title}${author ? ` by ${author}` : ""}`}
      className={cn(
        "@container relative aspect-[2/3] w-full -rotate-2 overflow-hidden rounded-[5px] shadow-cover select-none",
        className,
      )}
      style={{ backgroundColor: variant.background, color: variant.ink }}
    >
      <span className="absolute inset-y-0 left-0 w-[7%] bg-black/18" />
      <span className="absolute inset-y-0 left-[7%] w-px bg-white/15" />
      <div className="relative flex h-full flex-col px-[12%] pt-[11%] pb-[10%] pl-[16%]">
        {label ? (
          <span className="text-[5.5cqw] font-medium tracking-[0.16em] uppercase opacity-80">
            {label}
          </span>
        ) : null}
        <span className="mt-[6%] h-px w-[38%] bg-current opacity-40" />
        <span className="mt-auto line-clamp-5 font-serif text-[11.5cqw] leading-[1.08] font-semibold [overflow-wrap:anywhere]">
          {title}
        </span>
        {author ? <span className="mt-[7%] truncate text-[6cqw] opacity-85">{author}</span> : null}
      </div>
    </div>
  );
}
