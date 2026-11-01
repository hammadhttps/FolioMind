"use client";

import "./globals.css";

/* Replaces the root layout when it fails, so it renders its own document and no providers. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-svh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong on our side.</h1>
          <p className="text-muted-foreground">
            Please try again. If it keeps happening, come back in a little while.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="h-9.5 rounded-button bg-primary px-4 font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload on purpose: the app router may be unusable here */}
            <a
              href="/"
              className="inline-flex h-9.5 items-center rounded-button border border-input px-4 font-medium hover:bg-muted"
            >
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
