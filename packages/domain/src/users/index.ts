import { PLAN_CODES, THEME_PREFERENCES, type ThemePreference } from "@foliomind/contracts";
import { userPreferences, users, type Database, type Executor } from "@foliomind/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "../audit";
import { effectivePlanCode } from "../entitlements";
import { findVerifiedEmailOwner, isSignInProvider, parseSub, recordIdentity } from "../identities";

/*
 * Local accounts (blueprint Sections 4, 6 and 22). Users are upserted by their
 * primary Auth0 `sub`, never matched by email. Provider-managed fields (email,
 * verification) refresh on every sign-in; name and picture are copied only when
 * the account is created, so later edits are never overwritten.
 */

export const USER_ROLES = ["reader", "publisher", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ["active", "suspended", "deleting"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** What a request needs about its user; cached for 60 seconds (Section 23). */
export const userSnapshotSchema = z.object({
  id: z.uuid(),
  auth0Sub: z.string().min(1),
  email: z.string(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  planCode: z.enum(PLAN_CODES),
  theme: z.enum(THEME_PREFERENCES),
});
export type UserSnapshot = z.infer<typeof userSnapshotSchema>;

export async function loadUserSnapshot(db: Executor, userId: string): Promise<UserSnapshot | null> {
  const [row] = await db
    .select({
      id: users.id,
      auth0Sub: users.auth0Sub,
      email: users.email,
      emailVerified: users.emailVerified,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      theme: userPreferences.theme,
    })
    .from(users)
    .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(eq(users.id, userId));
  if (!row || row.deletedAt) return null;
  const { deletedAt: _deletedAt, theme, ...user } = row;
  return { ...user, theme: theme ?? "light", planCode: await effectivePlanCode(db, user.id) };
}

export async function findUserIdBySub(db: Executor, sub: string): Promise<string | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.auth0Sub, sub));
  return row?.id ?? null;
}

/** ID-token claims the callback passes in (only the ones FolioMind reads). */
export interface SignInClaims {
  sub: string;
  email?: string | null;
  emailVerified?: boolean | null;
  name?: string | null;
  nickname?: string | null;
  picture?: string | null;
}

export type SignInRefusal =
  "unsupported_method" | "no_email" | "existing_account" | "suspended" | "deleted";

export type SignInOutcome =
  | { kind: "signed_in"; user: UserSnapshot; created: boolean }
  /** `deleteAuth0User`: the Auth0 user behind `sub` is an orphan to delete (rule 3). */
  | { kind: "refused"; reason: SignInRefusal; deleteAuth0User: boolean };

const refused = (reason: SignInRefusal, deleteAuth0User = false): SignInOutcome => ({
  kind: "refused",
  reason,
  deleteAuth0User,
});

/**
 * The callback's upsert (Section 22 rules 1–3 and 7). Never merges by email: a
 * new `sub` whose verified email belongs to another account is refused.
 */
export async function signIn(
  db: Database,
  claims: SignInClaims,
  now: Date = new Date(),
): Promise<SignInOutcome> {
  return db.transaction(async (tx) => {
    const identity = parseSub(claims.sub);
    const email = claims.email?.trim() || null;
    const emailVerified = claims.emailVerified === true;

    const [existing] = await tx
      .select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.auth0Sub, claims.sub))
      .for("update");

    let userId = existing?.id;
    let created = false;

    if (existing) {
      if (existing.deletedAt || existing.status === "deleting") return refused("deleted");
      if (existing.status === "suspended") {
        await writeAudit(tx, {
          actorId: existing.id,
          action: "user.signin_refused",
          targetType: "user",
          targetId: existing.id,
          metadata: { reason: "suspended" },
        });
        return refused("suspended");
      }
      await tx
        .update(users)
        .set({ ...(email ? { email } : {}), emailVerified, updatedAt: now })
        .where(eq(users.id, existing.id));
    } else {
      if (!identity || !isSignInProvider(identity.provider)) return refused("unsupported_method");
      if (!email) return refused("no_email");

      if (emailVerified && (await findVerifiedEmailOwner(tx, email, claims.sub))) {
        await writeAudit(tx, {
          actorId: null,
          action: "user.signin_refused",
          targetType: "auth0_user",
          targetId: claims.sub,
          metadata: { reason: "existing_account", provider: identity.provider },
        });
        return refused("existing_account", true);
      }

      const [inserted] = await tx
        .insert(users)
        .values({
          auth0Sub: claims.sub,
          email,
          emailVerified,
          displayName: initialDisplayName(claims, email),
          avatarUrl: httpsUrlOrNull(claims.picture),
        })
        .onConflictDoNothing({ target: users.auth0Sub })
        .returning({ id: users.id });
      if (inserted) {
        userId = inserted.id;
        created = true;
      } else {
        // A concurrent callback for the same `sub` created it first.
        userId = (
          await tx.select({ id: users.id }).from(users).where(eq(users.auth0Sub, claims.sub))
        )[0]?.id;
      }
    }

    if (!userId) throw new Error("Sign-in could not resolve the local user");
    await tx.insert(userPreferences).values({ userId }).onConflictDoNothing();
    if (identity) {
      await recordIdentity(tx, { userId, identity, email, lastLoginAt: now });
    }

    const user = await loadUserSnapshot(tx, userId);
    if (!user) throw new Error("Sign-in could not load the local user");
    return { kind: "signed_in", user, created };
  });
}

function initialDisplayName(claims: SignInClaims, email: string): string {
  const candidates = [claims.name, claims.nickname, email.split("@")[0]];
  const name = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return (name ?? "Reader").trim().slice(0, 60);
}

function httpsUrlOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Profile edits (Section 28); the caller validates with `profileFormSchema`. */
export async function updateDisplayName(
  db: Executor,
  userId: string,
  displayName: string,
): Promise<void> {
  await db.update(users).set({ displayName }).where(eq(users.id, userId));
}

export async function updateThemePreference(
  db: Executor,
  userId: string,
  theme: ThemePreference,
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, theme })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { theme, updatedAt: sql`now()` } });
}

export class UserLookupError extends Error {}

/**
 * Admin is granted only through an audited privileged process (Section 4): the
 * `promote-admin` script. The role change and its audit entry commit together.
 */
export async function grantRoleByEmail(
  db: Database,
  input: { email: string; role: UserRole; actorId?: string | null; reason: string },
): Promise<{ userId: string; previousRole: UserRole }> {
  return db.transaction(async (tx) => {
    const matches = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        and(sql`lower(${users.email}) = lower(${input.email})`, sql`${users.deletedAt} is null`),
      )
      .for("update");
    if (matches.length === 0) {
      throw new UserLookupError("No FolioMind account uses that email. Sign in once first.");
    }
    if (matches.length > 1) {
      throw new UserLookupError(
        `${matches.length} accounts use that email; resolve the duplicates before granting a role.`,
      );
    }
    const [user] = matches as [{ id: string; role: UserRole }];
    await tx.update(users).set({ role: input.role }).where(eq(users.id, user.id));
    await writeAudit(tx, {
      actorId: input.actorId ?? null,
      action: "user.role_granted",
      targetType: "user",
      targetId: user.id,
      metadata: { role: input.role, previousRole: user.role, reason: input.reason.slice(0, 200) },
    });
    return { userId: user.id, previousRole: user.role };
  });
}
