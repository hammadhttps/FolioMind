"use client";

import { ErrorState } from "@/components/foliomind/error-state";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState reset={reset} homeHref="/dashboard" />;
}
