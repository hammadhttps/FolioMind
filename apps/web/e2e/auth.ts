import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import {
  assets,
  createDb,
  documentChunks,
  documents,
  documentVersions,
  libraryItems,
  usageBuckets,
  userPreferences,
  users,
} from "@foliomind/db";
import { signIn, type UserSnapshot } from "@foliomind/domain";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
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

/** The page the reader last saved for a user's document, if any. */
export async function savedPage(userId: string): Promise<number | null> {
  const [row] = await db().execute<{ page_number: number }>(
    sql`select page_number from reading_progress where user_id = ${userId} order by last_read_at desc limit 1`,
  );
  return row ? Number(row.page_number) : null;
}

export async function savedTheme(userId: string) {
  const [row] = await db()
    .select({ theme: userPreferences.theme })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return row?.theme;
}

/** The local UploadThing token from apps/web/.env.local, if set (never printed). */
export function uploadThingToken(): string | undefined {
  const file = path.resolve(__dirname, "../.env.local");
  if (process.env.UPLOADTHING_TOKEN) return process.env.UPLOADTHING_TOKEN;
  if (!existsSync(file)) return undefined;
  return parseEnv(readFileSync(file, "utf8")).UPLOADTHING_TOKEN || undefined;
}

/** Removes test users and everything they own, children first, and their stored files. */
export async function deleteTestUsers(ids: readonly string[]) {
  const token = uploadThingToken();
  for (const id of ids) {
    const stored = await db().execute<{ file_key: string }>(
      sql`select file_key from assets where owner_id = ${id} and state <> 'deleted' and file_key not like 'e2e-missing-%'`,
    );
    if (token && stored.length > 0) {
      const { UTApi } = await import("uploadthing/server");
      await new UTApi({ token, logLevel: "Fatal" })
        .deleteFiles(stored.map((row) => row.file_key))
        .catch(() => {});
    }
    await db().transaction(async (tx) => {
      await tx.execute(sql`delete from projects where owner_id = ${id}`);
      await tx.execute(sql`delete from conversations where user_id = ${id}`);
      await tx.execute(sql`delete from workspaces where owner_id = ${id}`);
      await tx.execute(sql`delete from collections where user_id = ${id}`);
      await tx.execute(sql`delete from library_items where user_id = ${id}`);
      await tx.execute(sql`delete from annotations where user_id = ${id}`);
      await tx.execute(sql`delete from upload_intents where user_id = ${id}`);
      await tx.execute(
        sql`delete from usage_operations where bucket_id in (select id from usage_buckets where user_id = ${id})`,
      );
      await tx.execute(sql`delete from usage_buckets where user_id = ${id}`);
      await tx.execute(sql`delete from ai_runs where user_id = ${id}`);
      await tx.execute(sql`delete from url_imports where user_id = ${id}`);
      await tx.execute(sql`delete from jobs where owner_id = ${id}`);
      await tx.execute(sql`delete from documents where owner_id = ${id}`);
      await tx.execute(sql`delete from assets where owner_id = ${id}`);
      await tx.delete(users).where(eq(users.id, id));
    });
  }
}

/**
 * Gives a seeded document searchable text, one chunk per page. No embeddings are
 * needed: full-text search finds these, and Jina still reranks them for real.
 */
export async function seedChunks(documentId: string, pages: readonly string[]) {
  const versionId = await currentVersionId(documentId);
  await db()
    .insert(documentChunks)
    .values(
      pages.map((text, index) => ({
        documentVersionId: versionId,
        chunkIndex: index,
        pageStart: index + 1,
        pageEnd: index + 1,
        text,
        tokenCount: Math.ceil(text.length / 5),
        contentHash: randomUUID(),
      })),
    );
  await db()
    .update(documentVersions)
    .set({ pageCount: pages.length })
    .where(eq(documentVersions.id, versionId));
}

/** Uses up `consumed` of this month's AI questions, as earlier questions would have. */
export async function useUpQuestions(userId: string, consumed: number) {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await db().insert(usageBuckets).values({
    userId,
    metric: "ai_questions",
    periodStart,
    periodEnd,
    limit: 30,
    consumed,
  });
}

/** The source versions a project was created with. */
export async function projectSourceCount(projectId: string): Promise<number> {
  const [row] = await db().execute<{ count: number }>(
    sql`select count(*)::int as count from project_sources where project_id = ${projectId}`,
  );
  return Number(row?.count ?? 0);
}

/** The current version of a document, for checks on its citations and sources. */
export async function currentVersionId(documentId: string): Promise<string> {
  const [row] = await db()
    .select({ versionId: documents.currentVersionId })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!row?.versionId) throw new Error("document has no version");
  return row.versionId;
}

/** True when this server can answer: it reads both AI keys from apps/web/.env.local. */
export function hasAiKeys(): boolean {
  const file = path.resolve(__dirname, "../.env.local");
  const local = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return Boolean(
    (process.env.GEMINI_API_KEY || local.GEMINI_API_KEY) &&
    (process.env.JINA_API_KEY || local.JINA_API_KEY),
  );
}

/**
 * A library document whose stored file does not exist: enough for My Library,
 * access checks and deletion. Reading real pages needs an actual upload.
 */
export async function seedDocument(
  userId: string,
  title: string,
  status: "queued" | "ready" | "failed" = "queued",
  fileKey = `e2e-missing-${randomUUID()}`,
): Promise<{ documentId: string; libraryItemId: string }> {
  const database = db();
  const [asset] = await database
    .insert(assets)
    .values({
      ownerId: userId,
      fileKey,
      customId: `e2e-${randomUUID()}`,
      fileRoute: "sourcePdf",
      acl: "private",
      purpose: "source",
      bytes: 1000,
      mimeType: "application/pdf",
      state: "ready",
    })
    .returning({ id: assets.id });
  const [document] = await database
    .insert(documents)
    .values({ ownerId: userId, title, sourceKind: "upload" })
    .returning({ id: documents.id });
  const [version] = await database
    .insert(documentVersions)
    .values({
      documentId: document!.id,
      versionNo: 1,
      assetId: asset!.id,
      status,
      indexVersion: "e2e",
      embeddingModel: "e2e",
      embeddingDimension: 1024,
    })
    .returning({ id: documentVersions.id });
  await database
    .update(documents)
    .set({ currentVersionId: version!.id })
    .where(eq(documents.id, document!.id));
  const [item] = await database
    .insert(libraryItems)
    .values({ userId, documentId: document!.id })
    .returning({ id: libraryItems.id });
  return { documentId: document!.id, libraryItemId: item!.id };
}

/** True when a Worker A is connected to the local Inngest Dev Server. */
export async function hasConnectedWorker(): Promise<boolean> {
  const response = await fetch("http://127.0.0.1:8288/v0/gql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ apps { name connected } }" }),
  }).catch(() => null);
  if (!response?.ok) return false;
  const body = (await response.json().catch(() => null)) as {
    data?: { apps?: { name: string; connected: boolean }[] };
  } | null;
  return Boolean(
    body?.data?.apps?.some((app) => app.name === "foliomind-ingestion" && app.connected),
  );
}
