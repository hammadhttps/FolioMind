"use client";

import { useState, type ReactNode } from "react";
import { LogoMark } from "@/components/icons/logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DEFAULT_RETURN_TO, safeReturnTo } from "@/lib/auth/return-to";
import { SignInPanel } from "./sign-in-panel";

/** Where to return after sign-in: the current page, or the dashboard from Home. */
function currentLocation(): string {
  const { pathname, search } = window.location;
  return pathname === "/" || pathname === "/login" ? DEFAULT_RETURN_TO : `${pathname}${search}`;
}

/**
 * Shared sign-in dialog (Section 22) opened from the header, Home and Pricing.
 * It holds the same panel as the /login page.
 */
export function SignInDialog({ children, returnTo }: { children: ReactNode; returnTo?: string }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(DEFAULT_RETURN_TO);

  function handleOpenChange(next: boolean) {
    if (next) setTarget(safeReturnTo(returnTo ?? currentLocation()));
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-6 overflow-y-auto p-6 sm:max-w-[440px]">
        <DialogHeader className="items-center gap-3 text-center sm:text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary-subtle">
            <LogoMark className="size-7 text-primary" />
          </span>
          <DialogTitle className="font-serif text-2xl font-semibold">
            Welcome to FolioMind
          </DialogTitle>
          <DialogDescription className="text-[0.9375rem] text-muted-foreground">
            Sign in or create your account to save books, upload PDFs and ask cited questions.
          </DialogDescription>
        </DialogHeader>
        {open ? <SignInPanel returnTo={target} /> : null}
      </DialogContent>
    </Dialog>
  );
}
