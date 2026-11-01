import { TriangleAlert } from "lucide-react";

export function DevBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning-bg px-4 py-2 text-sm text-warning">
      <TriangleAlert className="size-4" aria-hidden="true" />
      <span className="font-semibold">Development preview</span>
      <span className="text-foreground/80">
        · labelled sample data, not available in production builds
      </span>
      {children}
    </div>
  );
}
