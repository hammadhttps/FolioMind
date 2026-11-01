import { randomUUID } from "node:crypto";
import { auditLogs, userIdentities, userPreferences, users } from "@foliomind/db";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createUser, describeWithDatabase, testDb, uniqueEmail } from "../test/db";
import { grantRoleByEmail, signIn, updateDisplayName, UserLookupError } from ".";

const googleSub = () => `google-oauth2|${randomUUID()}`;
const githubSub = () => `github|${randomUUID()}`;

describeWithDatabase("signIn", () => {
  it("creates one user, preferences and identity on first sign-in", async () => {
    const db = testDb();
    const sub = googleSub();
    const email = uniqueEmail();
    const outcome = await signIn(db, {
      sub,
      email,
      emailVerified: true,
      name: "Ada Reader",
      picture: "https://lh3.googleusercontent.com/a/photo",
    });

    expect(outcome).toMatchObject({ kind: "signed_in", created: true });
    if (outcome.kind !== "signed_in") return;
    expect(outcome.user).toMatchObject({
      auth0Sub: sub,
      email,
      emailVerified: true,
      displayName: "Ada Reader",
      avatarUrl: "https://lh3.googleusercontent.com/a/photo",
      role: "reader",
      status: "active",
      planCode: "free",
      theme: "light",
    });
    const identities = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, outcome.user.id));
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ provider: "google-oauth2", email });
    expect(identities[0]?.lastLoginAt).toBeInstanceOf(Date);
    const preferences = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, outcome.user.id));
    expect(preferences).toHaveLength(1);
  });

  it("matches returning users by sub and never overwrites fields they edited", async () => {
    const db = testDb();
    const sub = githubSub();
    const first = await signIn(db, {
      sub,
      email: uniqueEmail(),
      emailVerified: false,
      name: "octo",
    });
    if (first.kind !== "signed_in") throw new Error("expected sign-in");
    await updateDisplayName(db, first.user.id, "My chosen name");

    const newEmail = uniqueEmail();
    const again = await signIn(db, {
      sub,
      email: newEmail,
      emailVerified: true,
      name: "Provider Name Changed",
      picture: "https://avatars.githubusercontent.com/u/2",
    });

    expect(again).toMatchObject({ kind: "signed_in", created: false });
    if (again.kind !== "signed_in") return;
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.displayName).toBe("My chosen name");
    expect(again.user.avatarUrl).toBeNull();
    // Email and verification are provider-managed and do refresh.
    expect(again.user).toMatchObject({ email: newEmail, emailVerified: true });
    const rows = await db.select().from(users).where(eq(users.auth0Sub, sub));
    expect(rows).toHaveLength(1);
  });

  it("upserts by sub, not email: an unverified duplicate email gets its own account", async () => {
    const db = testDb();
    const email = uniqueEmail();
    const original = await createUser(db, { email, emailVerified: false });
    const outcome = await signIn(db, { sub: githubSub(), email, emailVerified: false });
    expect(outcome).toMatchObject({ kind: "signed_in", created: true });
    if (outcome.kind === "signed_in") expect(outcome.user.id).not.toBe(original.id);
  });

  it("refuses a new sub whose verified email belongs to another account (rule 3)", async () => {
    const db = testDb();
    const email = uniqueEmail();
    await createUser(db, { email: email.toUpperCase(), emailVerified: true });
    const sub = githubSub();

    const outcome = await signIn(db, { sub, email, emailVerified: true, name: "Second" });

    expect(outcome).toEqual({ kind: "refused", reason: "existing_account", deleteAuth0User: true });
    expect(await db.select().from(users).where(eq(users.auth0Sub, sub))).toHaveLength(0);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "user.signin_refused"), eq(auditLogs.targetId, sub)));
    expect(audit).toHaveLength(1);
  });

  it("refuses suspended and deleting accounts", async () => {
    const db = testDb();
    const suspended = await createUser(db, { status: "suspended" });
    const deleting = await createUser(db, { status: "deleting" });

    expect(
      await signIn(db, { sub: suspended.auth0Sub, email: suspended.email, emailVerified: true }),
    ).toEqual({
      kind: "refused",
      reason: "suspended",
      deleteAuth0User: false,
    });
    expect(
      await signIn(db, { sub: deleting.auth0Sub, email: deleting.email, emailVerified: true }),
    ).toEqual({
      kind: "refused",
      reason: "deleted",
      deleteAuth0User: false,
    });
  });

  it("refuses methods FolioMind does not offer and accounts without an email", async () => {
    const db = testDb();
    for (const sub of [`auth0|${randomUUID()}`, `email|${randomUUID()}`, "no-separator"]) {
      expect(await signIn(db, { sub, email: uniqueEmail(), emailVerified: true })).toMatchObject({
        kind: "refused",
        reason: "unsupported_method",
      });
    }
    expect(await signIn(db, { sub: githubSub(), email: null, emailVerified: false })).toMatchObject(
      {
        kind: "refused",
        reason: "no_email",
      },
    );
  });

  it("creates exactly one user when the same first sign-in races itself", async () => {
    const db = testDb();
    const sub = googleSub();
    const claims = { sub, email: uniqueEmail(), emailVerified: true, name: "Racer" };
    const outcomes = await Promise.all([
      signIn(db, claims),
      signIn(db, claims),
      signIn(db, claims),
    ]);
    expect(outcomes.every((outcome) => outcome.kind === "signed_in")).toBe(true);
    expect(await db.select().from(users).where(eq(users.auth0Sub, sub))).toHaveLength(1);
  });
});

describeWithDatabase("grantRoleByEmail", () => {
  it("grants admin and writes the audit entry in the same transaction", async () => {
    const db = testDb();
    const user = await createUser(db);
    const result = await grantRoleByEmail(db, {
      email: user.email.toUpperCase(),
      role: "admin",
      reason: "test",
    });
    expect(result).toEqual({ userId: user.id, previousRole: "reader" });
    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.role).toBe("admin");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.targetId, user.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "user.role_granted",
      safeMetadata: { role: "admin", previousRole: "reader", reason: "test" },
    });
  });

  it("refuses unknown emails", async () => {
    await expect(
      grantRoleByEmail(testDb(), { email: uniqueEmail(), role: "admin", reason: "test" }),
    ).rejects.toBeInstanceOf(UserLookupError);
  });
});
