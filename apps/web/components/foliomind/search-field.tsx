"use client";

import { Search, X } from "lucide-react";
import { useId } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/** Search input with icon and clear button (Section 24 `InputGroup`). */
export function SearchField({
  value,
  onValueChange,
  label,
  placeholder,
  className,
  maxLength = 100,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name; shown to screen readers only. */
  label: string;
  placeholder?: string;
  className?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className={cn("w-full", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <InputGroup className="h-10 bg-card">
        <InputGroupAddon>
          <Search className="size-4" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="search"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          className="text-[0.9375rem] [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => onValueChange("")}
            >
              <X aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}
