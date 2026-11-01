import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* Route-level loading skeletons that match each template's final layout. */

export function PageHeadingSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-3">
        <Skeleton className="h-8 w-64 max-w-full md:w-80" />
        <Skeleton className="h-5 w-80 max-w-full md:w-[28rem]" />
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, index) => (
            <Skeleton key={index} className="h-9.5 w-32" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ToolbarSkeleton() {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <Skeleton className="h-10 w-full md:max-w-md" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-20 rounded-full" />
        ))}
      </div>
    </div>
  );
}

export function CoverGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3 2xl:grid-cols-4", className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="aspect-[4/5] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("space-y-4 rounded-xl border bg-card p-5", className)}>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Skeleton className="h-11 rounded-none" />
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-t px-4 py-3">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Two-column work surfaces: Reader, Research Workspace and PDF Studio. */
export function SplitSkeleton({ rail = "left" }: { rail?: "left" | "right" }) {
  return (
    <div
      className={cn(
        "grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]",
        rail === "left" && "lg:grid-cols-[320px_minmax(0,1fr)]",
      )}
    >
      <Skeleton className="h-[420px] rounded-xl lg:h-[560px]" />
      <Skeleton className="h-[420px] rounded-xl lg:h-[560px]" />
    </div>
  );
}
