/**
 * Auth0 settings for the server Playwright starts. The domain does not resolve
 * and the secret protects nothing real: signed-in tests mint their own session
 * cookies with it (e2e/auth.ts), so no test ever contacts an Auth0 tenant.
 */
export const E2E_AUTH0 = {
  AUTH0_DOMAIN: "foliomind-e2e.invalid",
  AUTH0_CLIENT_ID: "foliomind-e2e-client",
  AUTH0_CLIENT_SECRET: "foliomind-e2e-client-secret",
  AUTH0_SECRET: "foliomind-e2e-only-session-secret-0123456789",
  APP_BASE_URL: "http://localhost:3000",
} as const;
