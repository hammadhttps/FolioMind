import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/foliomind/app-shell";
import { PublicFooter } from "@/components/foliomind/public-footer";
import { PublicHeader } from "@/components/foliomind/public-header";
import { PublicPage } from "@/components/foliomind/public-page";
import { StatusAlert } from "@/components/foliomind/status-alert";
import { SAMPLE_USER } from "../../sample-data";
import { SCREEN_PREVIEWS } from "../registry";

export const metadata: Metadata = { title: "Screen preview", robots: { index: false } };

export function generateStaticParams() {
  return Object.keys(SCREEN_PREVIEWS).map((screen) => ({ screen }));
}

const notice = (
  <StatusAlert tone="warning" title="Development preview" className="mb-6">
    Sample user and labelled sample data. This page returns 404 in production builds.
  </StatusAlert>
);

export default async function ScreenPreviewPage({ params }: PageProps<"/dev/ui/screens/[screen]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  const preview = SCREEN_PREVIEWS[screen];
  if (!preview) notFound();

  if (preview.shell === "public") {
    return (
      <div className="flex min-h-svh flex-col">
        <PublicHeader />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <PublicPage>
            {notice}
            {preview.render()}
          </PublicPage>
        </main>
        <PublicFooter />
      </div>
    );
  }

  // The shell reads the pathname and search params, so it renders inside Suspense
  // here just as it does behind the session boundary in the (app) layout.
  return (
    <Suspense>
      <AppShell user={SAMPLE_USER} preview>
        {notice}
        {preview.render()}
      </AppShell>
    </Suspense>
  );
}
