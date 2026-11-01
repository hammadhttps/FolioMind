import {
  aiRuns,
  annotations,
  assets,
  billingCheckoutAttempts,
  billingCustomers,
  collections,
  contentReports,
  conversations,
  documents,
  libraryItems,
  projectRevisions,
  projects,
  publisherProfiles,
  readingProgress,
  subscriptions,
  uploadIntents,
  urlImports,
  usageBuckets,
  userIdentities,
  users,
  workspaceNotes,
  workspaces,
  workspaceSources,
  type Database,
  type Executor,
} from "@foliomind/db";
import {
  SIGN_IN_PROVIDERS,
  type IdentityResultCode,
  type SignInProvider,
} from "@foliomind/contracts";
import { and, asc, eq, exists, notInArray, or, sql, type SQL } from "drizzle-orm";
import { writeAudit } from "../audit";

/*
 * Sign-in methods (blueprint Section 22). `user_identities` mirrors the Auth0
 * identities linked to each user; Auth0 stays the source of truth, reached
 * through the injected `IdentityProviderAdmin` (Management API on the server).
 */

export type IdentityProvider = "auth0" | SignInProvider;

export interface ParsedSub {
  provider: IdentityProvider;
  providerUserId: string;
}

/** `google-oauth2|123` → provider and provider user ID; null for unknown prefixes. */
export function parseSub(sub: string): ParsedSub | null {
  const separator = sub.indexOf("|");
  if (separator <= 0 || separator === sub.length - 1) return null;
  const provider = sub.slice(0, separator);
  const providerUserId = sub.slice(separator + 1);
  if (provider !== "auth0" && !(SIGN_IN_PROVIDERS as readonly string[]).includes(provider)) {
    return null;
  }
  return { provider: provider as IdentityProvider, providerUserId };
}

/** New accounts may only come from the methods FolioMind offers (Google and GitHub). */
export function isSignInProvider(provider: string): provider is SignInProvider {
  return (SIGN_IN_PROVIDERS as readonly string[]).includes(provider);
}

export interface LinkedIdentity {
  provider: string;
  providerUserId: string;
  email?: string | null;
}

/** Management API operations the link and unlink flows need (Section 22 rule 8). */
export interface IdentityProviderAdmin {
  link(primarySub: string, secondary: ParsedSub): Promise<void>;
  unlink(primarySub: string, secondary: ParsedSub): Promise<void>;
  listIdentities(primarySub: string): Promise<LinkedIdentity[]>;
  deleteUser(sub: string): Promise<void>;
}

export async function recordIdentity(
  db: Executor,
  input: { userId: string; identity: ParsedSub; email: string | null; lastLoginAt?: Date },
): Promise<void> {
  await db
    .insert(userIdentities)
    .values({
      userId: input.userId,
      provider: input.identity.provider,
      providerUserId: input.identity.providerUserId,
      email: input.email,
      lastLoginAt: input.lastLoginAt ?? null,
    })
    .onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.providerUserId],
      set: {
        email: sql`excluded.email`,
        lastLoginAt: sql`coalesce(excluded.last_login_at, ${userIdentities.lastLoginAt})`,
        updatedAt: sql`now()`,
      },
      // A row owned by another user is left alone; the caller decides what that means.
      setWhere: eq(userIdentities.userId, input.userId),
    });
}

export async function listIdentities(db: Executor, userId: string) {
  return db
    .select({
      provider: userIdentities.provider,
      providerUserId: userIdentities.providerUserId,
      email: userIdentities.email,
      linkedAt: userIdentities.linkedAt,
      lastLoginAt: userIdentities.lastLoginAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(asc(userIdentities.linkedAt));
}

/** Replaces a user's mirror with what Auth0 reports, which wins over stale local rows. */
export async function syncIdentities(
  db: Executor,
  userId: string,
  linked: readonly LinkedIdentity[],
): Promise<void> {
  const parsed = linked
    .map((identity) => ({
      ...parseSub(`${identity.provider}|${identity.providerUserId}`),
      email: identity.email ?? null,
    }))
    .filter((identity): identity is ParsedSub & { email: string | null } =>
      Boolean(identity.provider && identity.providerUserId),
    );

  const keep = parsed.map((identity) => `${identity.provider}|${identity.providerUserId}`);
  await db
    .delete(userIdentities)
    .where(
      and(
        eq(userIdentities.userId, userId),
        keep.length > 0
          ? notInArray(
              sql`${userIdentities.provider}::text || '|' || ${userIdentities.providerUserId}`,
              keep,
            )
          : undefined,
      ),
    );
  for (const identity of parsed) {
    await db
      .insert(userIdentities)
      .values({
        userId,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
      })
      .onConflictDoUpdate({
        target: [userIdentities.provider, userIdentities.providerUserId],
        set: { userId, email: sql`excluded.email`, updatedAt: sql`now()` },
      });
  }
}

/** Another active local user who already proved ownership of this email (Section 22 rule 3). */
export async function findVerifiedEmailOwner(
  db: Executor,
  email: string,
  exceptSub: string,
): Promise<{ id: string } | null> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.email}) = lower(${email})`,
        eq(users.emailVerified, true),
        sql`${users.auth0Sub} <> ${exceptSub}`,
        sql`${users.deletedAt} is null`,
      ),
    )
    .limit(1);
  return owner ?? null;
}

/**
 * True when the user owns anything beyond an empty profile: every table whose
 * rows would block or lose data if the account were merged away (rule 5).
 */
export async function userHasContent(db: Executor, userId: string): Promise<boolean> {
  const owned: SQL[] = [
    exists(db.select().from(documents).where(eq(documents.ownerId, userId))),
    exists(db.select().from(assets).where(eq(assets.ownerId, userId))),
    exists(db.select().from(uploadIntents).where(eq(uploadIntents.userId, userId))),
    exists(db.select().from(urlImports).where(eq(urlImports.userId, userId))),
    exists(db.select().from(libraryItems).where(eq(libraryItems.userId, userId))),
    exists(db.select().from(collections).where(eq(collections.userId, userId))),
    exists(db.select().from(annotations).where(eq(annotations.userId, userId))),
    exists(db.select().from(readingProgress).where(eq(readingProgress.userId, userId))),
    exists(db.select().from(workspaces).where(eq(workspaces.ownerId, userId))),
    exists(db.select().from(workspaceSources).where(eq(workspaceSources.addedBy, userId))),
    exists(db.select().from(workspaceNotes).where(eq(workspaceNotes.authorId, userId))),
    exists(db.select().from(conversations).where(eq(conversations.userId, userId))),
    exists(db.select().from(projects).where(eq(projects.ownerId, userId))),
    exists(db.select().from(projectRevisions).where(eq(projectRevisions.createdBy, userId))),
    exists(db.select().from(publisherProfiles).where(eq(publisherProfiles.userId, userId))),
    exists(db.select().from(contentReports).where(eq(contentReports.reporterId, userId))),
    exists(db.select().from(billingCustomers).where(eq(billingCustomers.userId, userId))),
    exists(
      db.select().from(billingCheckoutAttempts).where(eq(billingCheckoutAttempts.userId, userId)),
    ),
    exists(db.select().from(subscriptions).where(eq(subscriptions.userId, userId))),
    exists(db.select().from(usageBuckets).where(eq(usageBuckets.userId, userId))),
    exists(db.select().from(aiRuns).where(eq(aiRuns.userId, userId))),
  ];
  const [row] = await db.execute<{ found: boolean }>(sql`select ${or(...owned)} as found`);
  return row?.found === true;
}

export type LinkOutcome = { ok: true } | { ok: false; code: IdentityResultCode };

export interface LinkInput {
  user: { id: string; auth0Sub: string; emailVerified: boolean };
  /** `sub` of the verified ID token from the separate authorization request. */
  secondarySub: string;
  /** The connection the user asked to connect. */
  connection: SignInProvider;
}

/**
 * Connect a method (Section 22 rules 4 and 5): the primary `sub` never changes,
 * and an identity that already owns a FolioMind account with content is refused.
 */
export async function linkIdentity(
  db: Database,
  admin: IdentityProviderAdmin,
  { user, secondarySub, connection }: LinkInput,
): Promise<LinkOutcome> {
  if (!user.emailVerified) return { ok: false, code: "email_unverified" };
  if (secondarySub === user.auth0Sub) return { ok: false, code: "already_linked" };

  const secondary = parseSub(secondarySub);
  // Auth0 answers with the primary `sub` when the identity is already linked
  // elsewhere, so a different provider means another account holds it.
  if (!secondary || secondary.provider !== connection) {
    await refuseLink(db, user.id, connection, "linked_elsewhere");
    return { ok: false, code: "account_has_content" };
  }

  const [mirror] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, secondary.provider),
        eq(userIdentities.providerUserId, secondary.providerUserId),
      ),
    );
  if (mirror?.userId === user.id) return { ok: false, code: "already_linked" };

  const [secondaryUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.auth0Sub, secondarySub));
  if (mirror && mirror.userId !== secondaryUser?.id) {
    await refuseLink(db, user.id, connection, "linked_elsewhere");
    return { ok: false, code: "account_has_content" };
  }
  if (secondaryUser && (await userHasContent(db, secondaryUser.id))) {
    await refuseLink(db, user.id, connection, "has_content");
    return { ok: false, code: "account_has_content" };
  }

  await admin.link(user.auth0Sub, secondary);
  const linked = await admin.listIdentities(user.auth0Sub);

  await db.transaction(async (tx) => {
    // The secondary's empty FolioMind account (no content, checked above) merges away.
    if (secondaryUser) await tx.delete(users).where(eq(users.id, secondaryUser.id));
    await syncIdentities(tx, user.id, linked);
    await writeAudit(tx, {
      actorId: user.id,
      action: "identity.linked",
      targetType: "user",
      targetId: user.id,
      metadata: { provider: connection, mergedEmptyAccount: Boolean(secondaryUser) },
    });
  });
  return { ok: true };
}

async function refuseLink(
  db: Executor,
  userId: string,
  provider: SignInProvider,
  reason: string,
): Promise<void> {
  await writeAudit(db, {
    actorId: userId,
    action: "identity.link_refused",
    targetType: "user",
    targetId: userId,
    metadata: { provider, reason },
  });
}

/** Disconnect needs a sign-in within this window (Section 22 rule 6). */
export const RECENT_AUTHENTICATION_MS = 10 * 60 * 1000;

export function isRecentAuthentication(signedInAt: Date | null, now: Date = new Date()): boolean {
  return signedInAt !== null && now.getTime() - signedInAt.getTime() <= RECENT_AUTHENTICATION_MS;
}

export interface UnlinkInput {
  user: { id: string; auth0Sub: string };
  provider: SignInProvider;
  recentlyAuthenticated: boolean;
}

/** Disconnect (rule 6): recent sign-in required, never the primary or the last method. */
export async function unlinkIdentity(
  db: Database,
  admin: IdentityProviderAdmin,
  { user, provider, recentlyAuthenticated }: UnlinkInput,
): Promise<LinkOutcome> {
  if (!recentlyAuthenticated) return { ok: false, code: "reauthentication_required" };

  const identities = await listIdentities(db, user.id);
  const target = identities.find((identity) => identity.provider === provider);
  if (!target) return { ok: false, code: "not_linked" };
  if (identities.length <= 1) return { ok: false, code: "last_method" };
  const primary = parseSub(user.auth0Sub);
  if (primary?.provider === target.provider && primary.providerUserId === target.providerUserId) {
    return { ok: false, code: "primary_method" };
  }

  await admin.unlink(user.auth0Sub, { provider, providerUserId: target.providerUserId });
  const linked = await admin.listIdentities(user.auth0Sub);

  await db.transaction(async (tx) => {
    await syncIdentities(tx, user.id, linked);
    await writeAudit(tx, {
      actorId: user.id,
      action: "identity.unlinked",
      targetType: "user",
      targetId: user.id,
      metadata: { provider },
    });
  });
  return { ok: true };
}
