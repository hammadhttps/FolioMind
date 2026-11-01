"use client";

import { Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  adminNav,
  billingNav,
  discoverNav,
  settingsNav,
  workspaceNav,
  type NavItem,
} from "@/lib/navigation";

/**
 * Global search (⌘K / Ctrl+K). Phase 3 offers navigation to pages the user can
 * open; permission-filtered content search is wired in Phase 9.
 */
export function CommandMenu({
  open,
  onOpenChange,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const groups: { heading: string; items: NavItem[] }[] = [
    { heading: "Workspace", items: workspaceNav },
    { heading: "Discover", items: discoverNav },
    { heading: "Account", items: [settingsNav, billingNav] },
    ...(isAdmin ? [{ heading: "Admin", items: adminNav }] : []),
  ];

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search FolioMind"
      description="Go to a page"
      className="sm:max-w-[520px]"
    >
      {/* This CommandDialog does not include cmdk's root, so it is added here. */}
      <Command>
        <CommandInput placeholder="Go to a page…" />
        <CommandList>
          <CommandEmpty>No pages match that search.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`${group.heading} ${item.title}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon aria-hidden="true" />
                    {item.title}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          <CommandGroup heading="Plans">
            <CommandItem value="Plans Pricing" onSelect={() => go("/pricing")}>
              <Tag aria-hidden="true" />
              Pricing
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
