import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Titled card section (Section 19), e.g. "Your recent projects". */
export function Panel({
  title,
  description,
  action,
  children,
  headingLevel = "h2",
  className,
  contentClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  headingLevel?: "h2" | "h3";
  className?: string;
  contentClassName?: string;
}) {
  const Heading = headingLevel;
  return (
    <Card className={cn("gap-0 py-0", className)}>
      {title || action ? (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0 space-y-1">
            {title ? (
              <Heading className="text-[1.0625rem] font-semibold tracking-[-0.01em] md:text-lg">
                {title}
              </Heading>
            ) : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("px-5 pb-5", !title && !action && "pt-5", contentClassName)}>
        {children}
      </div>
    </Card>
  );
}
