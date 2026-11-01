import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** Thin indigo fill over a neutral track (Section 19), with a readable label. */
export function ProgressBar({
  value,
  label,
  valueLabel,
  className,
}: {
  /** 0–100, or null when unknown (renders an empty track and "—"). */
  value: number | null;
  label: string;
  valueLabel?: string;
  className?: string;
}) {
  const clamped = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {valueLabel ?? (value === null ? "—" : `${Math.round(clamped)}%`)}
        </span>
      </div>
      <Progress
        value={clamped}
        aria-label={label}
        aria-valuetext={valueLabel ?? (value === null ? "Not available yet" : undefined)}
        className="h-1.5"
      />
    </div>
  );
}
