import type { ReactNode } from "react";
import { PublicPage } from "./public-page";
import { StatusAlert } from "./status-alert";

/** Layout for Privacy and Terms; both are drafts the owner must replace before launch. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PublicPage className="max-w-3xl space-y-8 md:py-14">
      <h1 className="text-[1.875rem]/tight font-semibold tracking-[-0.015em]">{title}</h1>
      <StatusAlert tone="warning" title="Draft text">
        This page is a placeholder written during development. It is not legal advice and must be
        replaced with reviewed terms before FolioMind launches.
      </StatusAlert>
      <div className="space-y-6 text-base/relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_ul]:space-y-1.5">
        {children}
      </div>
    </PublicPage>
  );
}
