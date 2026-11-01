"use client";

import { LayoutDashboard, LogIn, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/icons/logo";
import { SignInDialog } from "./sign-in-dialog";

const PUBLIC_LINKS = [
  { title: "Explore", href: "/library" },
  { title: "Pricing", href: "/pricing" },
] as const;

function isCurrent(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/library") {
    return (
      pathname === "/library" ||
      pathname.startsWith("/books/") ||
      pathname.startsWith("/publishers/")
    );
  }
  return pathname === href;
}

/** Desktop links. Rendered without an active state while the pathname is unknown. */
export function PublicNavLinks({ pathname = null }: { pathname?: string | null }) {
  return (
    <nav aria-label="Primary" className="max-md:hidden">
      <ul className="flex items-center gap-1">
        {PUBLIC_LINKS.map((link) => {
          const current = isCurrent(pathname, link.href);
          return (
            <li key={link.href}>
              <Button
                asChild
                variant="ghost"
                className="font-medium text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground"
              >
                <Link href={link.href} aria-current={current ? "page" : undefined}>
                  {link.title}
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Reads the pathname, so it renders inside a <Suspense> boundary (Cache Components). */
export function PublicNav() {
  return <PublicNavLinks pathname={usePathname()} />;
}

export function GuestActions() {
  return (
    <>
      <SignInDialog>
        <Button variant="ghost" className="font-medium max-md:hidden">
          <LogIn aria-hidden="true" />
          Sign in
        </Button>
      </SignInDialog>
      <SignInDialog returnTo="/dashboard">
        <Button className="font-medium max-sm:h-8 max-sm:px-3 max-sm:text-[0.8125rem]">
          Get started
        </Button>
      </SignInDialog>
      <PublicMobileMenu signedIn={false} />
    </>
  );
}

export function MemberActions() {
  return (
    <>
      <Button asChild className="font-medium">
        <Link href="/dashboard">
          <LayoutDashboard aria-hidden="true" />
          Dashboard
        </Link>
      </Button>
      <PublicMobileMenu signedIn />
    </>
  );
}

function PublicMobileMenu({ signedIn }: { signedIn: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[280px] gap-0 p-0">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
          <Logo size="sidebar" />
        </SheetHeader>
        <nav aria-label="Mobile" className="grid gap-1 p-3">
          {[
            ...PUBLIC_LINKS,
            { title: "Privacy", href: "/privacy" },
            { title: "Terms", href: "/terms" },
          ].map((link) => (
            <SheetClose asChild key={link.href}>
              <Link
                href={link.href}
                className="flex h-11 items-center rounded-button px-3 font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/70 focus-visible:outline-none"
              >
                {link.title}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <Separator />
        <div className="grid gap-2 p-4">
          {signedIn ? (
            <SheetClose asChild>
              <Button asChild size="lg">
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </SheetClose>
          ) : (
            <>
              <SignInDialog returnTo="/dashboard">
                <Button size="lg">Get started</Button>
              </SignInDialog>
              <SignInDialog>
                <Button size="lg" variant="outline">
                  <LogIn aria-hidden="true" />
                  Sign in
                </Button>
              </SignInDialog>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
