import { ArrowUpRight, Network } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Research workspace card (Section 20): collection label, name and source count. */
export function WorkspaceCard({
  name,
  href,
  sourceCount,
  label,
  updatedLabel,
  className,
}: {
  name: string;
  href: string;
  sourceCount: number;
  label?: string | null;
  updatedLabel?: string | null;
  className?: string;
}) {
  return (
    <Card className={cn("group relative gap-3 p-5 transition-colors hover:bg-muted/50", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-research-subtle text-research-subtle-foreground">
          <Network className="size-5" aria-hidden="true" />
        </span>
        <ArrowUpRight
          className="size-4 text-muted-foreground group-hover:text-foreground"
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0 space-y-1">
        {label ? (
          <p className="truncate text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {label}
          </p>
        ) : null}
        <h3 className="truncate text-base font-semibold">
          <Link
            href={href}
            className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:ring-3 focus-visible:ring-ring/70"
          >
            {name}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground">
          {sourceCount === 1 ? "1 source" : `${sourceCount} sources`}
          {updatedLabel ? ` · ${updatedLabel}` : null}
        </p>
      </div>
    </Card>
  );
}
