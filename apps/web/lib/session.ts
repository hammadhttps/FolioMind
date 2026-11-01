import "server-only";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import {
  CACHE_TTL_SECONDS,
  cached,
  findUserIdBySub,
  isAdmin,
  isPublisher,
  loadUserSnapshot,
  userSnapshotSchema,
  writeCache,
  type UserSnapshot,
} from "@foliomind/domain";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { LOCAL_USER_CLAIM } from "./auth/claims";
import type { SessionUser } from "./auth/types";
import { auth0 } from "./auth0";
import { getCacheKeys, getDb, getRequestRedis } from "./clients";

export type { SessionUser };

/*
 * The signed-in user (blueprint Sections 4, 22 and 23): the Auth0 session names
 * the local account, whose role, status and plan come from a 60-second cached
 * snapshot. Suspension deletes the snapshot, and privileged mutations re-read
 * Postgres with `getFreshUser`. Reading the session is request data: call these
 * inside a <Suspense> boundary.
 */

export interface CurrentUser extends UserSnapshot {
  /** When this session signed in; Disconnect needs a recent one (Section 22 rule 6). */
  signedInAt: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readSession(): Promise<SessionData | null> {
  if (!auth0) {
    // Still request-time without Auth0, so local builds render like configured ones.
    await connection();
    return null;
  }
  return auth0.getSession();
}

async function resolveUserId(session: SessionData): Promise<string | null> {
  const claimed = session.user[LOCAL_USER_CLAIM];
  if (typeof claimed === "string" && UUID.test(claimed)) return claimed;
  // Sessions from before the local account existed carry no claim.
  return findUserIdBySub(getDb(), session.user.sub);
}

function signedInAt(session: SessionData): Date | null {
  const createdAt = session.internal?.createdAt;
  return typeof createdAt === "number" ? new Date(createdAt * 1000) : null;
}

/** The signed-in local user, or null for guests and sessions without an account. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const userId = await resolveUserId(session);
  if (!userId) return null;

  const snapshot = await cached(getRequestRedis(), {
    key: getCacheKeys().userSnapshot(userId),
    ttlSeconds: CACHE_TTL_SECONDS.userSnapshot,
    schema: userSnapshotSchema,
    load: () => loadUserSnapshot(getDb(), userId),
  });
  // The snapshot must belong to this session's identity.
  if (!snapshot || snapshot.auth0Sub !== session.user.sub) return null;
  return { ...snapshot, signedInAt: signedInAt(session) };
});

/** Re-reads Postgres and refreshes the cache; for privileged mutations. */
export async function getFreshUser(): Promise<CurrentUser | null> {
  const session = await readSession();
  if (!session) return null;
  const userId = await resolveUserId(session);
  if (!userId) return null;
  const snapshot = await loadUserSnapshot(getDb(), userId);
  if (!snapshot || snapshot.auth0Sub !== session.user.sub) return null;
  await writeCache(
    getRequestRedis(),
    getCacheKeys().userSnapshot(userId),
    snapshot,
    CACHE_TTL_SECONDS.userSnapshot,
  );
  return { ...snapshot, signedInAt: signedInAt(session) };
}

/** Where a suspended or deleting account is signed out, with the reason shown on /login. */
export function signOutPath(status: CurrentUser["status"]): string | null {
  if (status === "suspended") return "/session/end?reason=suspended";
  if (status === "deleting") return "/session/end?reason=deleted";
  return null;
}

/**
 * For signed-in pages. The proxy already sends guests to /login; a session with
 * no local account goes there too, and suspended or deleting accounts are
 * signed out with a clear message.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const signOut = signOutPath(user.status);
  if (signOut) redirect(signOut);
  return user;
}

export class AccessDeniedError extends Error {
  constructor(readonly code: "forbidden" | "email_unverified") {
    super(code);
    this.name = "AccessDeniedError";
  }
}

/** Server-side role gate for actions and route handlers; hidden navigation is not security. */
export async function requireRole(role: "admin" | "publisher"): Promise<CurrentUser> {
  const user = await requireUser();
  const allowed = role === "admin" ? isAdmin(user) : isPublisher(user);
  if (!allowed) throw new AccessDeniedError("forbidden");
  return user;
}

/**
 * Section 22 rule 2: unverified users can read and upload, but cannot apply to
 * publish, buy Pro or connect sign-in methods until they verify.
 */
export async function requireVerifiedEmail(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.emailVerified) throw new AccessDeniedError("email_unverified");
  return user;
}

export function toSessionUser(user: UserSnapshot): SessionUser {
  return {
    id: user.id,
    name: user.displayName,
    email: user.email || null,
    picture: user.avatarUrl,
    role: user.role,
    isAdmin: isAdmin(user),
    emailVerified: user.emailVerified,
    theme: user.theme,
  };
}

/** For public pages: active accounts only, as the client-safe shape. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  return user && user.status === "active" ? toSessionUser(user) : null;
}

/** For the signed-in shell. */
export async function requireSessionUser(): Promise<SessionUser> {
  return toSessionUser(await requireUser());
}
