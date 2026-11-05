import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Integration tests use their own database (`foliomind_ai_test`), built by the
 * domain package's global setup, so `pnpm test` can run packages in parallel
 * without one dropping another's database.
 */
const base = new URL(
  process.env.TEST_DATABASE_URL || "postgres://foliomind:foliomind@localhost:5433/foliomind_test",
);
base.pathname = "/foliomind_ai_test";
process.env.TEST_DATABASE_URL = base.toString();

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: [fileURLToPath(import.meta.resolve("@foliomind/domain/test/global-setup"))],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
