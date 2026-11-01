"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/types";

const SessionUserContext = createContext<SessionUser | null>(null);

/** Provided by the workspace shell after the session is read (inside its Suspense boundary). */
export function SessionUserProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return <SessionUserContext value={user}>{children}</SessionUserContext>;
}

export function useSessionUser(): SessionUser {
  const user = useContext(SessionUserContext);
  if (!user) throw new Error("useSessionUser must be used inside the workspace shell");
  return user;
}

/** "Welcome back, Ada." — the personalized Dashboard line. */
export function WelcomeTitle() {
  const { name } = useSessionUser();
  const firstName = name.split(/\s+/)[0] ?? name;
  return <>Welcome back, {firstName}.</>;
}
