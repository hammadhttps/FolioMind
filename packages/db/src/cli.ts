import {
  describeDatabaseUrl,
  isLocalDatabaseUrl,
  migrationDatabaseUrl,
  runMigrations,
} from "./migrate";
import { configureRuntimeRole, DEFAULT_RUNTIME_ROLE } from "./roles";
import { createDb } from "./client";
import { assertDevSeedAllowed, seedDev } from "./seed/dev";
import { seedRequired } from "./seed/required";

/*
 * Database maintenance commands, run with tsx as the migration role
 * (DIRECT_DATABASE_URL; the local Compose database when unset):
 *
 *   migrate      apply pending migrations (same folder as `pnpm db:migrate`)
 *   roles        create/update the runtime role and its grants
 *   seed         plans and categories (every environment)
 *   seed:dev     sample publisher and books (local databases only)
 *   setup        migrate, roles and seed, as the Compose `migrate` service does
 */

const command = process.argv[2];
const url = migrationDatabaseUrl();
const LOCAL_RUNTIME_PASSWORD = "foliomind_app";

async function roles(): Promise<void> {
  const role = process.env.DATABASE_RUNTIME_ROLE || DEFAULT_RUNTIME_ROLE;
  // Local databases get the development password from the .env.example files.
  const password =
    process.env.DATABASE_RUNTIME_PASSWORD ||
    (isLocalDatabaseUrl(url) ? LOCAL_RUNTIME_PASSWORD : undefined);
  const { client, close } = createDb({ url, role: "script" });
  try {
    const result = await configureRuntimeRole(client, { role, password });
    console.log(
      `Runtime role ${result.role} ${result.created ? "created" : "updated"}; grants applied.`,
    );
  } finally {
    await close();
  }
}

async function seed(dev: boolean): Promise<void> {
  if (dev) assertDevSeedAllowed(url, process.env);
  const { db, close } = createDb({ url, role: "script" });
  try {
    const required = await seedRequired(db);
    console.log(`Plans upserted: ${required.plans}; new categories: ${required.categories}.`);
    if (dev) {
      const sample = await seedDev(db);
      console.log(`Sample publisher and ${sample.books} sample books are in place.`);
      console.log(
        "For an admin account: sign in once, then run `pnpm promote-admin <your email>`.",
      );
    }
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  console.log(`Database: ${describeDatabaseUrl(url)}`);
  switch (command) {
    case "migrate":
      await runMigrations(url);
      console.log("Migrations applied.");
      return;
    case "roles":
      return roles();
    case "seed":
      return seed(false);
    case "seed:dev":
      return seed(true);
    case "setup":
      await runMigrations(url);
      console.log("Migrations applied.");
      await roles();
      return seed(false);
    default:
      throw new Error("Usage: cli.ts <migrate|roles|seed|seed:dev|setup>");
  }
}

main().catch((error: unknown) => {
  // Messages only: driver errors can echo connection details in their stack.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
