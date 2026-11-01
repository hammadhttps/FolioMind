import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth0 } from "./auth0";
import type { SessionUser } from "./auth/types";

export type { SessionUser };

/*
 * The narrow identity the UI needs from the Auth0 session. Phase 4 replaces this
 * with the local user record (role, status, plan) behind the same helpers.
 * Reading the session is request data: call these inside a <Suspense> boundary.
 */

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!auth0) {
    // Still request-time without Auth0, so local builds render like configured ones.
    await connection();
    return null;
  }
  const session = await auth0.getSession();
  if (!session) return null;

  const { name, nickname, email, picture } = session.user;
  return {
    name: firstNonEmpty(name, nickname, email?.split("@")[0]) ?? "Reader",
    email: email ?? null,
    picture: picture ?? null,
    // Roles live in the local database from Phase 4; until then nobody is an admin.
    isAdmin: false,
  };
}

/** For signed-in layouts; the proxy normally redirects guests before this runs. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}
