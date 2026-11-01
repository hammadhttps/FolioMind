import {
  Compass,
  CreditCard,
  FileText,
  Gavel,
  LayoutDashboard,
  Library,
  Network,
  Send,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/** Workspace navigation (blueprint Sections 19 and 30). */
export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Whether the item is the current page for this pathname and `?tab=` value. */
  isActive: (pathname: string, tab: string | null) => boolean;
}

const startsWith = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const workspaceNav: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    isActive: (pathname, tab) => pathname === "/dashboard" && tab !== "research",
  },
  {
    title: "My Library",
    href: "/dashboard/library",
    icon: Library,
    isActive: (pathname) =>
      startsWith(pathname, "/dashboard/library") || startsWith(pathname, "/read"),
  },
  {
    title: "Research",
    href: "/dashboard?tab=research",
    icon: Network,
    isActive: (pathname, tab) =>
      (pathname === "/dashboard" && tab === "research") ||
      startsWith(pathname, "/dashboard/research"),
  },
  {
    title: "My Projects",
    href: "/dashboard/projects",
    icon: FileText,
    isActive: (pathname) => startsWith(pathname, "/dashboard/projects"),
  },
];

export const discoverNav: NavItem[] = [
  {
    title: "Explore",
    href: "/library",
    icon: Compass,
    isActive: (pathname) =>
      startsWith(pathname, "/library") ||
      startsWith(pathname, "/books") ||
      startsWith(pathname, "/publishers"),
  },
  {
    title: "Publishing",
    href: "/dashboard/publishing",
    icon: Send,
    isActive: (pathname) => startsWith(pathname, "/dashboard/publishing"),
  },
];

/** Shown only to admins (roles arrive in Phase 4); the routes are server-protected too. */
export const adminNav: NavItem[] = [
  {
    title: "Admin",
    href: "/admin",
    icon: ShieldCheck,
    isActive: (pathname) => pathname === "/admin",
  },
  {
    title: "Moderation",
    href: "/admin/moderation",
    icon: Gavel,
    isActive: (pathname) => startsWith(pathname, "/admin/moderation"),
  },
];

export const settingsNav: NavItem = {
  title: "Settings",
  href: "/dashboard/settings",
  icon: Settings,
  isActive: (pathname) => startsWith(pathname, "/dashboard/settings"),
};

export const billingNav: NavItem = {
  title: "Billing",
  href: "/dashboard/billing",
  icon: CreditCard,
  isActive: (pathname) => startsWith(pathname, "/dashboard/billing"),
};

export interface Crumb {
  label: string;
  href?: string;
}

/** Topbar breadcrumb for a workspace pathname. */
export function breadcrumbFor(pathname: string, tab: string | null): Crumb[] {
  if (pathname === "/dashboard") {
    return [{ label: "Workspace" }, { label: tab === "research" ? "Research" : "Dashboard" }];
  }
  if (startsWith(pathname, "/dashboard/library"))
    return [{ label: "Workspace" }, { label: "My Library" }];
  if (startsWith(pathname, "/read")) {
    return [{ label: "My Library", href: "/dashboard/library" }, { label: "Reader" }];
  }
  if (startsWith(pathname, "/dashboard/research")) {
    return [{ label: "Research", href: "/dashboard?tab=research" }, { label: "Workspace" }];
  }
  if (pathname === "/dashboard/projects") return [{ label: "Workspace" }, { label: "My Projects" }];
  if (startsWith(pathname, "/dashboard/projects")) {
    return [{ label: "My Projects", href: "/dashboard/projects" }, { label: "PDF Studio" }];
  }
  if (startsWith(pathname, "/dashboard/publishing"))
    return [{ label: "Discover" }, { label: "Publishing" }];
  if (startsWith(pathname, "/dashboard/settings"))
    return [{ label: "Account" }, { label: "Settings" }];
  if (startsWith(pathname, "/dashboard/billing"))
    return [{ label: "Account" }, { label: "Billing" }];
  if (pathname === "/admin") return [{ label: "Admin" }, { label: "Overview" }];
  if (startsWith(pathname, "/admin/moderation")) {
    return [{ label: "Admin", href: "/admin" }, { label: "Moderation" }];
  }
  return [{ label: "Workspace" }];
}
