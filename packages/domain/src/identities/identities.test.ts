import { randomUUID } from "node:crypto";
import { auditLogs, collections, userIdentities, users } from "@foliomind/db";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { createUser, describeWithDatabase, testDb } from "../test/db";
import { signIn } from "../users";
import {
  isRecentAuthentication,
  linkIdentity,
  listIdentities,
  parseSub,
  unlinkIdentity,
  type IdentityProviderAdmin,
  type LinkedIdentity,
} from ".";

/** In-memory stand-in for the Auth0 Management API. */
function fakeAdmin(initial: Record<string, LinkedIdentity[]>) {
  const identities = new Map(Object.entries(initial));
  const admin: IdentityProviderAdmin = {
    link: vi.fn(async (primarySub, secondary) => {
      identities.set(primarySub, [
        ...(identities.get(primarySub) ?? []),
        { provider: secondary.provider, providerUserId: secondary.providerUserId },
      ]);
    }),
    unlink: vi.fn(async (primarySub, secondary) => {
      identities.set(
        primarySub,
        (identities.get(primarySub) ?? []).filter(
          (identity) =>
            identity.provider !== secondary.provider ||
            identity.providerUserId !== secondary.providerUserId,
        ),
      );
    }),
    listIdentities: vi.fn(async (primarySub) => identities.get(primarySub) ?? []),
    deleteUser: vi.fn(async () => {}),
  };
  return admin;
}

async function signedInUser(sub = `google-oauth2|${randomUUID()}`) {
  const outcome = await signIn(testDb(), {
    sub,
    email: `user-${randomUUID()}@example.com`,
    emailVerified: true,
    name: "Primary",
  });
  if (outcome.kind !== "signed_in") throw new Error("expected sign-in");
  return outcome.user;
}

const ownIdentity = (sub: string): LinkedIdentity => {
  const parsed = parseSub(sub)!;
  return { provider: parsed.provider, providerUserId: parsed.providerUserId };
};

describeWithDatabase("linkIdentity", () => {
  it("links a fresh identity to the primary user and keeps the primary sub", async () => {
    const db = testDb();
    const user = await signedInUser();
    const secondarySub = `github|${randomUUID()}`;
    const admin = fakeAdmin({ [user.auth0Sub]: [ownIdentity(user.auth0Sub)] });

    expect(await linkIdentity(db, admin, { user, secondarySub, connection: "github" })).toEqual({
      ok: true,
    });
    expect(admin.link).toHaveBeenCalledWith(user.auth0Sub, parseSub(secondarySub));
    const identities = await listIdentities(db, user.id);
    expect(identities.map((identity) => identity.provider).sort()).toEqual([
      "github",
      "google-oauth2",
    ]);
    const [primary] = await db.select().from(users).where(eq(users.id, user.id));
    expect(primary?.auth0Sub).toBe(user.auth0Sub);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "identity.linked"), eq(auditLogs.targetId, user.id)));
    expect(audit).toHaveLength(1);
  });

  it("merges away an empty account that already belonged to the secondary identity", async () => {
    const db = testDb();
    const user = await signedInUser();
    const secondary = await signedInUser(`github|${randomUUID()}`);
    const admin = fakeAdmin({ [user.auth0Sub]: [ownIdentity(user.auth0Sub)] });

    expect(
      await linkIdentity(db, admin, {
        user,
        secondarySub: secondary.auth0Sub,
        connection: "github",
      }),
    ).toEqual({ ok: true });
    expect(await db.select().from(users).where(eq(users.id, secondary.id))).toHaveLength(0);
    const [mirror] = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.providerUserId, parseSub(secondary.auth0Sub)!.providerUserId));
    expect(mirror?.userId).toBe(user.id);
  });

  it("refuses an identity whose FolioMind account has content (rule 5)", async () => {
    const db = testDb();
    const user = await signedInUser();
    const populated = await signedInUser(`github|${randomUUID()}`);
    await db.insert(collections).values({ userId: populated.id, name: "Mine" });
    const admin = fakeAdmin({ [user.auth0Sub]: [ownIdentity(user.auth0Sub)] });

    expect(
      await linkIdentity(db, admin, {
        user,
        secondarySub: populated.auth0Sub,
        connection: "github",
      }),
    ).toEqual({ ok: false, code: "account_has_content" });
    expect(admin.link).not.toHaveBeenCalled();
    expect(await db.select().from(users).where(eq(users.id, populated.id))).toHaveLength(1);
  });

  it("refuses unverified users, the same identity and identities linked elsewhere", async () => {
    const db = testDb();
    const user = await signedInUser();
    const admin = fakeAdmin({});

    expect(
      await linkIdentity(db, admin, {
        user: { ...user, emailVerified: false },
        secondarySub: `github|${randomUUID()}`,
        connection: "github",
      }),
    ).toEqual({ ok: false, code: "email_unverified" });
    expect(
      await linkIdentity(db, admin, {
        user,
        secondarySub: user.auth0Sub,
        connection: "google-oauth2",
      }),
    ).toEqual({ ok: false, code: "already_linked" });
    // Auth0 answered with another account's primary sub for the GitHub login.
    expect(
      await linkIdentity(db, admin, {
        user,
        secondarySub: `google-oauth2|${randomUUID()}`,
        connection: "github",
      }),
    ).toEqual({ ok: false, code: "account_has_content" });
    expect(admin.link).not.toHaveBeenCalled();
  });
});

describeWithDatabase("unlinkIdentity", () => {
  async function linkedUser() {
    const db = testDb();
    const user = await signedInUser();
    const secondarySub = `github|${randomUUID()}`;
    const admin = fakeAdmin({ [user.auth0Sub]: [ownIdentity(user.auth0Sub)] });
    await linkIdentity(db, admin, { user, secondarySub, connection: "github" });
    return { user, admin };
  }

  it("requires a recent sign-in", async () => {
    const { user, admin } = await linkedUser();
    expect(
      await unlinkIdentity(testDb(), admin, {
        user,
        provider: "github",
        recentlyAuthenticated: false,
      }),
    ).toEqual({ ok: false, code: "reauthentication_required" });
    expect(admin.unlink).not.toHaveBeenCalled();
  });

  it("disconnects a secondary method, updates the mirror and audits it", async () => {
    const db = testDb();
    const { user, admin } = await linkedUser();
    expect(
      await unlinkIdentity(db, admin, { user, provider: "github", recentlyAuthenticated: true }),
    ).toEqual({ ok: true });
    expect((await listIdentities(db, user.id)).map((identity) => identity.provider)).toEqual([
      "google-oauth2",
    ]);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "identity.unlinked"), eq(auditLogs.targetId, user.id)));
    expect(audit).toHaveLength(1);
  });

  it("refuses the last method and the primary method", async () => {
    const db = testDb();
    const single = await signedInUser();
    const admin = fakeAdmin({});
    expect(
      await unlinkIdentity(db, admin, {
        user: single,
        provider: "google-oauth2",
        recentlyAuthenticated: true,
      }),
    ).toEqual({ ok: false, code: "last_method" });

    const { user, admin: linkedAdmin } = await linkedUser();
    expect(
      await unlinkIdentity(db, linkedAdmin, {
        user,
        provider: "google-oauth2",
        recentlyAuthenticated: true,
      }),
    ).toEqual({ ok: false, code: "primary_method" });
    expect(
      await unlinkIdentity(db, linkedAdmin, {
        user: single,
        provider: "github",
        recentlyAuthenticated: true,
      }),
    ).toEqual({ ok: false, code: "not_linked" });
  });
});

it("parses subs and recent authentication windows", () => {
  expect(parseSub("google-oauth2|123")).toEqual({
    provider: "google-oauth2",
    providerUserId: "123",
  });
  expect(parseSub("github|a|b")).toEqual({ provider: "github", providerUserId: "a|b" });
  expect(parseSub("email|x")).toBeNull();
  expect(parseSub("github|")).toBeNull();

  const now = new Date("2026-11-02T12:00:00Z");
  expect(isRecentAuthentication(new Date("2026-11-02T11:55:00Z"), now)).toBe(true);
  expect(isRecentAuthentication(new Date("2026-11-02T11:45:00Z"), now)).toBe(false);
  expect(isRecentAuthentication(null, now)).toBe(false);
});
