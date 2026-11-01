import { defineConfig } from "drizzle-kit";

/*
 * Migrations run as the migration role over DIRECT_DATABASE_URL (blueprint
 * Sections 3 and 13). Without it, commands target the local Compose database.
 */
const LOCAL_DATABASE_URL = "postgres://foliomind:foliomind@localhost:5433/foliomind";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL || LOCAL_DATABASE_URL,
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  strict: true,
  verbose: true,
});
