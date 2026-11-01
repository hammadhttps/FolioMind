"use client";

import type { ComponentProps, MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * An action that a later phase enables. It stays focusable (`aria-disabled`,
 * not `disabled`) so keyboard and pointer users can read why it is unavailable.
 */
export function ComingSoonButton({
  reason = "Coming soon",
  onClick,
  ...props
}: ComponentProps<typeof Button> & { reason?: string }) {
  function block(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onClick?.(event);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-disabled="true" aria-description={reason} onClick={block} {...props} />
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
