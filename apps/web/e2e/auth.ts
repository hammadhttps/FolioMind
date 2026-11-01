import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import { createDb, userPreferences, users } from "@foliomind/db";
import { signIn, type UserSnapshot } from "@foliomind/domain";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_AUTH0 } from "./auth-config";

/*
 * Signed-in end-to-end tests without a real Auth0 tenant: the local user is
 * created through the same domain sign-in the callback uses, and the session
 * cookie is minted with the SDK's own test helper and the test-only secret the
 * Playwright server runs with. Everything else (proxy, session helpers, caches,
 * Server Actions) runs unchanged.
 */

/** The migration role on the local Compose database the dev server also uses. */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL || "postgres://foliomind:foliomind@localhost:5433/foliomind";

const repoRoot = path.resolve(__dirname, "../../..");

let connection: ReturnType<typeof createDb> | undefined;
const db = () => (connection ??= createDb({ url: E2E_DATABASE_URL, role: "script" })).db;

export async function closeE2eDatabase() {
  await connection?.close();
  connection = undefined;
}

/** True when the server runs with Auth0 configured (401 rather than the 503 guidance). */
export async function hasTestAuth(request: APIRequestContext): Promise<boolean> {
  const response = await request.get("/auth/profile", { maxRedirects: 0 });
  return response.status() === 401;
}

export interface TestUser extends UserSnapshot {
  firstName: string;
}

/** A brand-new Google user, signed up through the domain service. */
export async function createTestUser(): Promise<TestUser> {
  const first = `Tess${randomUUID().slice(0, 6)}`;
  const outcome = await signIn(db(), {
    sub: `google-oauth2|e2e-${randomUUID()}`,
    email: `e2e-${randomUUID()}@example.com`,
    emailVerified: true,
    name: `${first} Tester`,
  });
  if (outcome.kind !== "signed_in") throw new Error(`test sign-in refused: ${outcome.reason}`);
  return { ...outcome.user, firstName: first };
}

/** Puts a session for `user` into the browser context, as the Auth0 callback would. */
export async function signInAs(context: BrowserContext, user: UserSnapshot): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const value = await generateSessionCookie(
    {
      user: {
        sub: user.auth0Sub,
        email: user.email,
        email_verified: user.emailVerified,
        name: user.displayName,
        foliomind_user_id: user.id,
      },
      internal: { sid: randomUUID(), createdAt: now },
    },
    { secret: E2E_AUTH0.AUTH0_SECRET },
  );
  await context.addCookies([
    { name: "__session", value, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

/** Runs the real `pnpm promote-admin` script, which writes the audit entry. */
export function promoteWithScript(email: string): void {
  execSync(`pnpm promote-admin ${email} --reason "e2e admin test"`, {
    cwd: repoRoot,
    stdio: "pipe",
    env: { ...process.env, DIRECT_DATABASE_URL: E2E_DATABASE_URL },
  });
}

export async function setStatus(userId: string, status: "active" | "suspended") {
  await db().update(users).set({ status }).where(eq(users.id, userId));
}

export async function savedTheme(userId: string) {
  const [row] = await db()
    .select({ theme: userPreferences.theme })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return row?.theme;
}

export async function deleteTestUsers(ids: readonly string[]) {
  for (const id of ids) await db().delete(users).where(eq(users.id, id));
}
