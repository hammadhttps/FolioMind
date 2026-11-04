import { connect } from "node:net";
import { createDb } from "@foliomind/db";
import { runMigrations } from "@foliomind/db/migrate";
import { seedRequired } from "@foliomind/db/seed";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { TEST_DATABASE_URL, TEST_REDIS } from "./env";

/**
 * Integration tests run against the local Docker stack (`pnpm stack:up`) or the
 * CI service containers. The test database is dropped, recreated and migrated
 * from empty on every run, which is itself the "migrations apply cleanly"
 * check. Without Postgres or Redis the dependent tests skip with a message.
 */
export default async function setup(project: TestProject) {
  project.provide("databaseReady", await prepareDatabase());
  project.provide("redisReady", await redisReachable());
}

async function prepareDatabase(): Promise<boolean> {
  const target = new URL(TEST_DATABASE_URL);
  const name = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must name a database ending in _test");
  }
  // A plain TCP probe: a failed postgres.js query here crashes Vitest's
  // source-map handling instead of reaching a catch block.
  if (!(await portOpen(target.hostname, Number(target.port || 5432)))) {
    return unavailable(
      "Postgres is not reachable at TEST_DATABASE_URL; integration tests skip. Run `pnpm stack:up`.",
    );
  }
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await sql.unsafe(`drop database if exists "${name}" with (force)`);
    await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  await runMigrations(TEST_DATABASE_URL);
  const { db, close } = createDb({ url: TEST_DATABASE_URL, role: "script" });
  try {
    await seedRequired(db);
  } finally {
    await close();
  }
  return true;
}

async function redisReachable(): Promise<boolean> {
  try {
    const response = await fetch(TEST_REDIS.url, {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_REDIS.token}`, "content-type": "application/json" },
      body: JSON.stringify(["PING"]),
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) return true;
  } catch {
    // Fall through to the warning.
  }
  return unavailable("The Upstash proxy is not reachable; cache tests skip. Run `pnpm stack:up`.");
}

function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2000 });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** CI's integration job sets REQUIRE_TEST_SERVICES so a missing service fails instead of skipping. */
function unavailable(message: string): false {
  if (process.env.REQUIRE_TEST_SERVICES) throw new Error(`[domain tests] ${message}`);
  console.warn(`[domain tests] ${message}`);
  return false;
}
