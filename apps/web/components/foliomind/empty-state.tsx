import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Buttons or links offering the next step. */
  actions?: ReactNode;
  /** "dashed" is the prototype's empty panel; "plain" sits inside another card. */
  variant?: "dashed" | "plain";
  className?: string;
}

/** Supportive empty panel (Section 19/20), e.g. "No books here just yet." */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  variant = "dashed",
  className,
}: EmptyStateProps) {
  return (
    <Empty
      className={cn(
        "gap-5 px-6 py-10",
        variant === "dashed" && "border border-dashed border-border bg-card",
        className,
      )}
    >
      <EmptyHeader className="max-w-md">
        {Icon ? (
          <EmptyMedia
            variant="icon"
            className="size-12 rounded-xl bg-primary-subtle text-primary-subtle-foreground"
          >
            <Icon className="size-6" aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className="font-sans text-base font-semibold">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="text-[0.9375rem]">{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {actions ? (
        <EmptyContent className="flex-row flex-wrap justify-center">{actions}</EmptyContent>
      ) : null}
    </Empty>
  );
}
