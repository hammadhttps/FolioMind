import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Modest privacy/reassurance line with an optional help action (Section 19);
 * not a marketing footer.
 */
export function FooterNote({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <Lock className="size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
      {action}
    </div>
  );
}
