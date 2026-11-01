"use client";

import { ErrorState } from "@/components/foliomind/error-state";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-svh items-center outline-none">
      <ErrorState reset={reset} />
    </main>
  );
}
