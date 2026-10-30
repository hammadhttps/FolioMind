import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { env } from "@/env";

/**
 * Auth0 SDK client (blueprint Sections 3 and 22). Configuration is passed from
 * the validated environment. In development it is `null` until the AUTH0_*
 * variables are set; staging/production validation requires them.
 * Hooks, user upsert and identity rules are added in Phase 4.
 */
function createAuth0(): Auth0Client | null {
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET } = env;
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET || !AUTH0_SECRET) return null;
  return new Auth0Client({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    clientSecret: AUTH0_CLIENT_SECRET,
    secret: AUTH0_SECRET,
    appBaseUrl: env.APP_BASE_URL,
  });
}

export const auth0 = createAuth0();
