"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/types";

const SessionUserContext = createContext<SessionUser | null>(null);
/** True in the dev gallery, which renders screens with a sample user and no account. */
const PreviewContext = createContext(false);

/** Provided by the workspace shell after the session is read (inside its Suspense boundary). */
export function SessionUserProvider({
  user,
  preview = false,
  children,
}: {
  user: SessionUser;
  preview?: boolean;
  children: ReactNode;
}) {
  return (
    <SessionUserContext value={user}>
      <PreviewContext value={preview}>{children}</PreviewContext>
    </SessionUserContext>
  );
}

/** Screens skip account writes (Server Actions, API calls) in the dev gallery. */
export function useIsPreview(): boolean {
  return useContext(PreviewContext);
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
