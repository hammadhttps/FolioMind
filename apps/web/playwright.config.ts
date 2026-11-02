import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH0 } from "./e2e/auth-config";

const port = 3000;
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);
// Optional: PLAYWRIGHT_CHANNEL=chrome uses the locally installed Google Chrome
// instead of Playwright's downloaded Chromium (useful on slow connections).
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // The local dev server compiles each route on first visit, which can take
  // longer than a test's default 30 seconds when workers compile in parallel.
  timeout: isCI ? 30_000 : 90_000,
  // Server re-renders after URL and action changes are slower on a busy dev server.
  expect: { timeout: isCI ? 5_000 : 15_000 },
  reporter: isCI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Each worker is its own "client" for the 300/minute global rate limit, so
    // parallel tests from one machine do not throttle each other.
    extraHTTPHeaders: { "x-real-ip": `e2e-${randomUUID()}` },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], channel, viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    // CI runs against the production build; locally the dev server is reused if running.
    command: isCI ? "pnpm start" : "pnpm dev",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    // Test-only Auth0 settings: sessions are minted locally (e2e/auth.ts) and
    // never reach a real tenant. Variables already set in the shell win.
    env: { ...E2E_AUTH0, ...process.env } as Record<string, string>,
  },
});
