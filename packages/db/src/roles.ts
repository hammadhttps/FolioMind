import type { Sql } from "postgres";

/*
 * Runtime and migration roles (blueprint Sections 3 and 13). The migration role
 * owns the schema and connects through DIRECT_DATABASE_URL; the runtime role
 * behind DATABASE_URL can read and write rows but cannot change the schema, and
 * cannot rewrite or delete audit history.
 */

export const DEFAULT_RUNTIME_ROLE = "foliomind_app";

export interface RuntimeRoleOptions {
  role?: string;
  /** Creates the role, or resets its password, when given. */
  password?: string;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Idempotent: run after every migration. Grants cover existing tables, and
 * default privileges cover tables the migration role creates later.
 */
export async function configureRuntimeRole(
  sql: Sql,
  { role = DEFAULT_RUNTIME_ROLE, password }: RuntimeRoleOptions = {},
): Promise<{ role: string; created: boolean }> {
  if (!ROLE_NAME.test(role)) throw new Error(`Invalid role name: ${role}`);

  const [existing] = await sql<{ exists: boolean }[]>`
    select exists (select 1 from pg_roles where rolname = ${role}) as exists`;
  const exists = existing?.exists ?? false;
  if (!exists && !password) {
    throw new Error(
      `Role ${role} does not exist. Set DATABASE_RUNTIME_PASSWORD to create it, or create it in the database console first.`,
    );
  }

  const name = sql(role);
  if (password) {
    // Role DDL takes no bind parameters; the name matched ROLE_NAME and the literal is escaped.
    const literal = `'${password.replaceAll("'", "''")}'`;
    await sql.unsafe(
      exists
        ? `alter role "${role}" with login password ${literal}`
        : `create role "${role}" with login password ${literal} nosuperuser nocreatedb nocreaterole noinherit`,
    );
  }

  const [{ database, owner } = { database: "", owner: "" }] = await sql<
    { database: string; owner: string }[]
  >`select current_database() as database, current_user as owner`;

  await sql`grant connect on database ${sql(database)} to ${name}`;
  await sql`grant usage on schema public to ${name}`;
  await sql`grant select, insert, update, delete on all tables in schema public to ${name}`;
  await sql`grant usage, select on all sequences in schema public to ${name}`;
  await sql`alter default privileges for role ${sql(owner)} in schema public
    grant select, insert, update, delete on tables to ${name}`;
  await sql`alter default privileges for role ${sql(owner)} in schema public
    grant usage, select on sequences to ${name}`;
  // audit_logs is append-only (Section 12).
  await sql`revoke update, delete, truncate on table audit_logs from ${name}`;

  return { role, created: !exists };
}
