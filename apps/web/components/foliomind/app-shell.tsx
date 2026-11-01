"use client";

import { useState, type ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { SessionUser } from "@/lib/auth/types";
import { AppSidebar } from "./app-sidebar";
import { CommandMenu } from "./command-menu";
import { SessionUserProvider } from "./session-user";
import { ThemePreferenceSync } from "./theme-preference";
import { Topbar } from "./topbar";

/**
 * Workspace shell (Section 19): sidebar, 75px topbar and up to 1600px of content.
 * `preview` (the dev gallery) skips loading and saving the account's theme.
 */
export function AppShell({
  user,
  preview = false,
  children,
}: {
  user: SessionUser;
  preview?: boolean;
  children: ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <SessionUserProvider user={user} preview={preview}>
      {preview ? null : <ThemePreferenceSync theme={user.theme} />}
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset className="min-w-0">
          <Topbar user={user} onOpenSearch={() => setSearchOpen(true)} />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1600px] flex-1 px-[15px] py-6 outline-none sm:px-[18px] md:px-[25px] md:py-8 xl:px-9"
          >
            {children}
          </main>
        </SidebarInset>
        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} isAdmin={user.isAdmin} />
      </SidebarProvider>
    </SessionUserProvider>
  );
}
