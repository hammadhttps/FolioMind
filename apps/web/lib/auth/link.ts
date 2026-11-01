import "server-only";
import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { signInProviderSchema, type SignInProvider } from "@foliomind/contracts";
import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "@/env";

/*
 * Connect a sign-in method (blueprint Section 22 rule 4). A separate OIDC
 * authorization request, with its own state, nonce and PKCE verifier, runs for
 * the chosen connection with `prompt=login`, so the current session is never
 * replaced. The transaction lives in an encrypted, httpOnly, ten-minute cookie
 * scoped to the callback path, and the returned ID token is verified against
 * the tenant's keys before anything is linked.
 */

export const LINK_CALLBACK_PATH = "/api/account/identities/callback";
export const LINK_COOKIE = "fm_link_txn";
const LINK_TTL_SECONDS = 10 * 60;

const transactionSchema = z.object({
  state: z.string().min(32),
  nonce: z.string().min(32),
  codeVerifier: z.string().min(43),
  connection: signInProviderSchema,
  userId: z.uuid(),
});
type LinkTransaction = z.infer<typeof transactionSchema>;

export class LinkUnavailableError extends Error {}

function auth0Config() {
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET } = env;
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET || !AUTH0_SECRET) {
    throw new LinkUnavailableError("Auth0 is not configured");
  }
  return {
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    clientSecret: AUTH0_CLIENT_SECRET,
    secret: AUTH0_SECRET,
  };
}

/** A key for this cookie only, derived from the session secret. */
function cookieKey(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secret, "", "FolioMind sign-in method link v1", 32));
}

const random = () => randomBytes(32).toString("base64url");

export function linkRedirectUri(requestUrl: string): string {
  return new URL(LINK_CALLBACK_PATH, env.APP_BASE_URL ?? new URL(requestUrl).origin).toString();
}

/** Builds the authorization URL and the encrypted transaction cookie value. */
export async function startLink(input: {
  userId: string;
  connection: SignInProvider;
  requestUrl: string;
}): Promise<{ authorizeUrl: string; cookie: string; maxAge: number }> {
  const config = auth0Config();
  const transaction: LinkTransaction = {
    state: random(),
    nonce: random(),
    codeVerifier: random(),
    connection: input.connection,
    userId: input.userId,
  };
  const codeChallenge = createHash("sha256").update(transaction.codeVerifier).digest("base64url");

  const url = new URL(`https://${config.domain}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: linkRedirectUri(input.requestUrl),
    scope: "openid profile email",
    connection: input.connection,
    prompt: "login",
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();

  const cookie = await new EncryptJWT(transaction)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${LINK_TTL_SECONDS}s`)
    .encrypt(cookieKey(config.secret));
  return { authorizeUrl: url.toString(), cookie, maxAge: LINK_TTL_SECONDS };
}

export class LinkCallbackError extends Error {
  constructor(readonly reason: "cancelled" | "invalid_state" | "token_exchange" | "invalid_token") {
    super(reason);
    this.name = "LinkCallbackError";
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Validates state, exchanges the code with the PKCE verifier and verifies the
 * ID token's signature, issuer, audience, expiry and nonce.
 */
export async function completeLink(input: {
  cookie: string | undefined;
  searchParams: URLSearchParams;
  requestUrl: string;
}): Promise<{ userId: string; connection: SignInProvider; secondarySub: string }> {
  const config = auth0Config();
  if (input.searchParams.get("error")) throw new LinkCallbackError("cancelled");
  if (!input.cookie) throw new LinkCallbackError("invalid_state");

  let transaction: LinkTransaction;
  try {
    const { payload } = await jwtDecrypt(input.cookie, cookieKey(config.secret));
    transaction = transactionSchema.parse(payload);
  } catch {
    throw new LinkCallbackError("invalid_state");
  }
  const code = input.searchParams.get("code");
  if (!code || input.searchParams.get("state") !== transaction.state) {
    throw new LinkCallbackError("invalid_state");
  }

  const issuer = `https://${config.domain}/`;
  const tokenResponse = await fetch(new URL("/oauth/token", issuer), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: transaction.codeVerifier,
      redirect_uri: linkRedirectUri(input.requestUrl),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!tokenResponse?.ok) throw new LinkCallbackError("token_exchange");
  const tokens = z
    .object({ id_token: z.string().min(1) })
    .safeParse(await tokenResponse.json().catch(() => null));
  if (!tokens.success) throw new LinkCallbackError("token_exchange");

  jwks ??= createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));
  try {
    const { payload } = await jwtVerify(tokens.data.id_token, jwks, {
      issuer,
      audience: config.clientId,
    });
    if (payload.nonce !== transaction.nonce || typeof payload.sub !== "string") {
      throw new LinkCallbackError("invalid_token");
    }
    return {
      userId: transaction.userId,
      connection: transaction.connection,
      secondarySub: payload.sub,
    };
  } catch (error) {
    if (error instanceof LinkCallbackError) throw error;
    throw new LinkCallbackError("invalid_token");
  }
}
