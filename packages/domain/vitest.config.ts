import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Rebuilds the test database from empty and checks the Upstash proxy once per run.
    globalSetup: ["./src/test/global-setup.ts"],
    // Integration files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
