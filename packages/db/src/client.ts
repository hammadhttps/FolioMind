import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * "web" uses the pooled connection string (Neon pooler / PgBouncer transaction
 * mode), which cannot keep prepared statements. Workers and scripts use the
 * direct connection with a small, bounded pool (blueprint Section 3).
 */
export type DbRole = "web" | "worker" | "script";

export interface CreateDbOptions {
  url: string;
  role: DbRole;
  /** Maximum pool size; defaults to 5 for web and workers, 2 for scripts. */
  max?: number;
}

export function createDb({ url, role, max }: CreateDbOptions) {
  const client = postgres(url, {
    max: max ?? (role === "script" ? 2 : 5),
    prepare: role !== "web",
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: `foliomind-${role}` },
  });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    close: () => client.end({ timeout: 5 }),
  };
}

export type DbConnection = ReturnType<typeof createDb>;
export type Database = DbConnection["db"];
