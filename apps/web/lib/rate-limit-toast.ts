"use client";

import { toast } from "sonner";
import { rateLimitMessage } from "./rate-limit/message";

/** Section 23 toast for a `rate_limited` result or a 429 response. */
export function showRateLimitToast(retryAfterSeconds: number | undefined): void {
  toast.error(rateLimitMessage(Math.max(1, retryAfterSeconds ?? 30)));
}

/** Reads Retry-After from a 429 response and shows the toast; true when it did. */
export function handleRateLimitResponse(response: Response): boolean {
  if (response.status !== 429) return false;
  showRateLimitToast(Number(response.headers.get("retry-after")) || undefined);
  return true;
}
