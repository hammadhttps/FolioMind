"use client";

import { Check, ChevronsUpDown, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo } from "@/components/icons/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import type { SessionUser } from "@/lib/auth/types";
import { adminNav, discoverNav, settingsNav, workspaceNav, type NavItem } from "@/lib/navigation";
import { UserAvatar } from "./user-avatar";

/**
 * Workspace sidebar (blueprint Section 19): brand, Personal workspace switch,
 * WORKSPACE and DISCOVER groups, Pro card, Settings and the profile row.
 * Becomes a 240px drawer at 760px and below.
 */
export function AppSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const { setOpenMobile } = useSidebar();
  const closeDrawer = () => setOpenMobile(false);

  return (
    <Sidebar>
      <SidebarHeader className="gap-5 px-[18px] pt-[29px] pb-3">
        <Logo size="sidebar" href="/dashboard" className="self-start" />
        <WorkspaceSwitch />
      </SidebarHeader>

      <SidebarContent className="px-[18px]">
        <nav aria-label="Workspace">
          <NavGroup
            label="Workspace"
            items={workspaceNav}
            pathname={pathname}
            tab={tab}
            onNavigate={closeDrawer}
          />
          <NavGroup
            label="Discover"
            items={discoverNav}
            pathname={pathname}
            tab={tab}
            onNavigate={closeDrawer}
          />
          {user.isAdmin ? (
            <NavGroup
              label="Admin"
              items={adminNav}
              pathname={pathname}
              tab={tab}
              onNavigate={closeDrawer}
            />
          ) : null}
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-3 px-[18px] pb-5">
        <SidebarSeparator className="mx-0" />
        <ProCard onNavigate={closeDrawer} />
        <SidebarMenu>
          <SidebarMenuItem>
            <NavLink item={settingsNav} pathname={pathname} tab={tab} onNavigate={closeDrawer} />
          </SidebarMenuItem>
        </SidebarMenu>
        <Link
          href="/dashboard/settings"
          onClick={closeDrawer}
          className="flex items-center gap-3 rounded-lg p-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70"
        >
          <UserAvatar user={user} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            {user.email ? (
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            ) : null}
          </span>
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  tab,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  tab: string | null;
  onNavigate: () => void;
}) {
  return (
    <SidebarGroup className="px-0 py-2">
      <SidebarGroupLabel className="h-7 px-3 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">
        {items.map((item) => (
          <SidebarMenuItem key={item.href}>
            <NavLink item={item} pathname={pathname} tab={tab} onNavigate={onNavigate} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavLink({
  item,
  pathname,
  tab,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  tab: string | null;
  onNavigate: () => void;
}) {
  const active = item.isActive(pathname, tab);
  const Icon = item.icon;
  return (
    <SidebarMenuButton
      asChild
      isActive={active}
      className="h-[43px] gap-3 rounded-lg px-3 text-[0.9375rem] data-active:font-semibold [&_svg]:size-5"
    >
      <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
        <Icon aria-hidden="true" />
        <span>{item.title}</span>
      </Link>
    </SidebarMenuButton>
  );
}

/** Single-user workspaces at launch (Section 1): the switch names the current one. */
function WorkspaceSwitch() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70"
        >
          <span className="min-w-0 flex-1 truncate font-medium">Personal workspace</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        <DropdownMenuItem className="gap-2">
          <span className="flex-1">Personal workspace</span>
          <Check className="size-4" aria-label="Current workspace" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProCard({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="rounded-xl bg-primary-subtle p-4 text-primary-subtle-foreground">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4" aria-hidden="true" />
        FolioMind Pro
      </p>
      <p className="mt-1 text-[0.8125rem]/snug">More sources, questions and projects each month.</p>
      <Link
        href="/pricing"
        onClick={onNavigate}
        className="mt-2 inline-block rounded-sm text-[0.8125rem] font-semibold underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/70"
      >
        Compare plans
      </Link>
    </div>
  );
}
