"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

const pillClass =
  "h-9 rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:border-primary-subtle data-[state=on]:bg-primary-subtle data-[state=on]:text-primary-subtle-foreground";

/** Rounded filter pills (Section 24 `ToggleGroup`); single choice, e.g. All / Uploads / Saved. */
export function FilterTabs({
  options,
  value,
  onValueChange,
  label,
  className,
}: {
  options: FilterOption[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Keep one pill selected: ignore the "deselect" Radix emits on the active pill.
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      aria-label={label}
      spacing={2}
      className={cn("flex-wrap justify-start", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className={pillClass}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Multi-select pills with `aria-pressed` (Explore categories). Empty selection means "All". */
export function FilterPills({
  options,
  value,
  onValueChange,
  label,
  allLabel = "All",
  className,
}: {
  options: FilterOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  label: string;
  allLabel?: string;
  className?: string;
}) {
  const all = value.length === 0;
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      <button
        type="button"
        aria-pressed={all}
        data-state={all ? "on" : "off"}
        onClick={() => onValueChange([])}
        className={cn(pillClass, "outline-none focus-visible:ring-3 focus-visible:ring-ring/70")}
      >
        {allLabel}
      </button>
      {options.map((option) => {
        const pressed = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            data-state={pressed ? "on" : "off"}
            onClick={() =>
              onValueChange(
                pressed ? value.filter((item) => item !== option.value) : [...value, option.value],
              )
            }
            className={cn(
              pillClass,
              "outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
