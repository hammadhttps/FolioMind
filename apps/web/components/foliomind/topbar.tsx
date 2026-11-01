"use client";

import { Bell, CreditCard, LogOut, Menu, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/auth/types";
import { breadcrumbFor } from "@/lib/navigation";
import { EmptyState } from "./empty-state";
import { UserAvatar } from "./user-avatar";

/** Workspace topbar (Section 19): 75px on desktop, 64px at 760px and below. */
export function Topbar({ user, onOpenSearch }: { user: SessionUser; onOpenSearch: () => void }) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-card/95 px-[15px] backdrop-blur-md supports-backdrop-filter:bg-card/80 sm:px-[18px] md:h-[75px] md:gap-3 md:px-[25px] xl:px-9">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-1.5 md:hidden"
        aria-label="Open navigation"
        onClick={toggleSidebar}
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>
      <AppBreadcrumb />
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={onOpenSearch}
              aria-label="Search pages"
              aria-keyshortcuts="Meta+K Control+K"
              className="size-9.5 justify-start px-0 text-muted-foreground max-sm:justify-center sm:w-48 sm:px-3 lg:w-60"
            >
              <Search className="size-4" aria-hidden="true" />
              <span className="max-sm:hidden">Search</span>
              <Kbd className="ml-auto max-sm:hidden">⌘K</Kbd>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search (Ctrl+K or ⌘K)</TooltipContent>
        </Tooltip>
        <ThemeMenu />
        <NotificationsSheet />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

function AppBreadcrumb() {
  const crumbs = breadcrumbFor(usePathname(), useSearchParams().get("tab"));
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbItem className={last ? "min-w-0" : "max-sm:hidden"}>
                {last ? (
                  <BreadcrumbPage className="truncate font-semibold">{crumb.label}</BreadcrumbPage>
                ) : crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <span className="text-muted-foreground">{crumb.label}</span>
                )}
              </BreadcrumbItem>
              {last ? null : <BreadcrumbSeparator className="max-sm:hidden" />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Change appearance"
              className="max-sm:hidden"
            >
              <Sun className="size-5 dark:hidden" aria-hidden="true" />
              <Moon className="hidden size-5 dark:block" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Appearance</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "light"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className="gap-2">
            <Sun className="size-4" aria-hidden="true" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="gap-2">
            <Moon className="size-4" aria-hidden="true" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="gap-2">
            <Monitor className="size-4" aria-hidden="true" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Notification history arrives in Phase 6; until then the drawer is honestly empty. */
function NotificationsSheet() {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">Notifications</SheetTitle>
          <SheetDescription>Updates about your documents, research and projects.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 items-center p-5">
          <EmptyState
            variant="plain"
            icon={Bell}
            title="You're all caught up."
            description="When a document finishes processing or a project is ready, you'll see it here."
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/70"
        >
          <UserAvatar user={user} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <UserAvatar user={user} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {user.name}
            </span>
            {user.email ? (
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            ) : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings aria-hidden="true" />
            Profile and settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/billing">
            <CreditCard aria-hidden="true" />
            Billing and usage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/* A full page load: /auth/logout is handled by the Auth0 proxy, not a page. */}
          <a href="/auth/logout">
            <LogOut aria-hidden="true" />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
