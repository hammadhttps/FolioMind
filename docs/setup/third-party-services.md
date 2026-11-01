# Third-party services and local environment

This guide lists every external service FolioMind uses, what to create in each dashboard, and which environment variables go into which file. Real values live only in git-ignored files; the tracked `.env.example` files document every variable.

## Environment files

| File                          | Used by         | Created from                          |
| ----------------------------- | --------------- | ------------------------------------- |
| `apps/web/.env.local`         | Next.js web app | `apps/web/.env.example`               |
| `apps/worker-ingestion/.env`  | Worker A        | `apps/worker-ingestion/.env.example`  |
| `apps/worker-generation/.env` | Worker B        | `apps/worker-generation/.env.example` |
| `infra/.env`                  | Docker Compose  | `infra/.env.example`                  |

Each app gets only the variables it needs, so some keys (for example `JINA_API_KEY`) appear in more than one file. The defaults in the examples point at the local Docker stack, so a fresh clone works without any third-party keys.

**`APP_ENV`** controls validation: in `development` and `test`, third-party keys may be empty (features that need them report "not configured"); in `staging` and `production` every key listed for that app is required and the app refuses to start without it. Validation errors list variable names only, never values. On Vercel, `VERCEL_ENV` is used when `APP_ENV` is not set.

## Local development

```bash
pnpm stack:up          # Postgres+pgvector, Redis + Upstash REST proxy, Inngest Dev Server, Browserless
pnpm dev               # web on http://localhost:3000 and both workers (hot reload)
pnpm check:services    # smoke checks for every service
pnpm stack:down        # stop the stack (data stays in the postgres-data volume)
```

| Local service       | URL                     | Notes                                                                                              |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| Postgres + pgvector | `localhost:5433`        | Host port 5433 so a native PostgreSQL on 5432 is unaffected (`POSTGRES_HOST_PORT` in `infra/.env`) |
| Upstash REST proxy  | `http://localhost:8079` | `serverless-redis-http` in front of Redis; token `UPSTASH_LOCAL_TOKEN`                             |
| Inngest Dev Server  | `http://localhost:8288` | UI shows events, runs and connected apps; Connect gateway on 8289                                  |
| Browserless         | `ws://localhost:3001`   | Local Chromium under the Browserless license; token `BROWSERLESS_LOCAL_TOKEN`                      |

To run the production Docker images against the stack instead of `pnpm dev`: `docker compose -f infra/compose.yaml --profile app up --build`.

## Services provisioned through Vercel

Auth0, Stripe, Inngest and Upstash can be added as Vercel Marketplace integrations (Vercel project → Integrations). They create the provider accounts and inject variables into the Vercel project (Production and Preview). Some names differ from FolioMind's; the env loading maps them, so do not rename them:

| Injected by Vercel                   | Read as                    |
| ------------------------------------ | -------------------------- |
| `KV_REST_API_URL`                    | `UPSTASH_REDIS_REST_URL`   |
| `KV_REST_API_TOKEN`                  | `UPSTASH_REDIS_REST_TOKEN` |
| `AUTH0_MANAGEMENT_API_CLIENT_ID`     | `AUTH0_MGMT_CLIENT_ID`     |
| `AUTH0_MANAGEMENT_API_CLIENT_SECRET` | `AUTH0_MGMT_CLIENT_SECRET` |

A FolioMind name, when set, wins over its alias. Variables the app does not use (`KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`, `STRIPE_MCP_KEY`, the publishable keys) are ignored.

Integration variables are **Sensitive**: `vercel env pull` returns them empty. For local development, copy Auth0 and Stripe values from the provider dashboards (Vercel → Integrations → the integration → open in Auth0/Stripe) into `apps/web/.env.local` (and `STRIPE_SECRET_KEY` into `apps/worker-ingestion/.env`). Locally, Inngest and Upstash keep using the Docker stack. Keys you add yourself in Vercel (Gemini, Jina, UploadThing, database, `RATE_LIMIT_IP_SECRET`) must be ticked for **Preview** too if you want preview deployments, because Preview counts as staging and staging validates them.

The Inngest integration expects a serve endpoint on Vercel; FolioMind's functions run in the workers through Connect, so ignore its sync warnings for the web project. The Render workers (Phase 10) need the Inngest, Upstash and Stripe credentials copied from those dashboards.

## Services

### Neon (PostgreSQL + pgvector)

1. Create a Neon project in the region closest to your Vercel functions and Render workers. Keep branch `main` for production and create a `staging` branch (and optionally a `dev` branch).
2. Enable the `vector` extension (it is created by the first migration in Phase 4; Neon supports it on every plan).
3. Copy two connection strings per branch. In Neon's **Connect** dialog use the plain connection string (`postgresql://…`), not the `psql '…'` snippet; the env validation rejects anything that is not a URL. `channel_binding=require` may stay in the string: `createDb` removes it because the driver would send it to the server as an unknown setting.
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL` (web).
   - **Direct** → `DIRECT_DATABASE_URL` (workers and migrations).
4. Local development uses the Compose Postgres by default (`postgres://foliomind:foliomind@localhost:5433/foliomind`); point the variables at a Neon `dev` branch only if you prefer a cloud database.

### Auth0 (sign-in with Google and GitHub)

Create one tenant per environment (for example `foliomind-dev`, `foliomind-staging`, `foliomind-prod`). If the tenant came from the Vercel integration, its application already exists: open it and add the localhost URLs from step 1 next to the Vercel ones, plus your production URL (`https://<project>.vercel.app/auth/callback` and the matching logout URL and web origin).

1. **Applications → Create Application → Regular Web Application** named "FolioMind".
   - Allowed Callback URLs: `http://localhost:3000/auth/callback` (add staging/production URLs later).
   - Allowed Logout URLs: `http://localhost:3000`
   - Allowed Web Origins: `http://localhost:3000`
   - Copy **Domain** → `AUTH0_DOMAIN` (without `https://`), **Client ID** → `AUTH0_CLIENT_ID`, **Client Secret** → `AUTH0_CLIENT_SECRET`.
2. Generate `AUTH0_SECRET` with `openssl rand -hex 32` (64 hex characters). Set `APP_BASE_URL=http://localhost:3000`.
3. **Applications → Create Application → Machine to Machine** named "FolioMind Management", authorized for the **Auth0 Management API** with only `read:users`, `update:users` and `delete:users` (Section 22 rule 8). Copy its credentials → `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`.
4. **Google social connection** (Authentication → Social → Google): create your own OAuth client in Google Cloud Console (type _Web application_, authorized redirect URI `https://{AUTH0_DOMAIN}/login/callback`), configure the consent screen (app name, logo, support email, privacy and terms URLs), request only `openid`, `email`, `profile`, paste the client ID/secret into Auth0, and enable the connection for the FolioMind application only. Do not launch on Auth0's development keys.
5. **GitHub social connection** (Authentication → Social → GitHub): create a GitHub OAuth App owned by an organization (callback `https://{AUTH0_DOMAIN}/login/callback`), enable the email attribute (`read:user`, `user:email`), paste the credentials into Auth0 and enable it for the FolioMind application only. Use one OAuth App per environment.
6. **FolioMind's own sign-in screen**: set the Application Login URI to `https://<your-domain>/login` and turn the database (username and password) and passwordless connections off for the application, since FolioMind offers only Google and GitHub. Step-by-step settings and checks are in [auth0-sign-in.md](auth0-sign-in.md). Auth0's hosted login page is not used.
7. Before launch, configure a custom domain such as `auth.<your-domain>` and update the callbacks.

All `AUTH0_*` variables go in `apps/web/.env.local`. The Google/GitHub OAuth secrets live in Auth0, never in FolioMind. Until the variables are set, sign-in buttons return a 503 explaining what is missing; the rest of the site works.

### UploadThing (file storage)

1. Create one UploadThing app per environment.
2. In the app settings enable **ACL overrides** (needed for private source PDFs and exports, Section 25) and confirm your plan supports private files.
3. Copy the token → `UPLOADTHING_TOKEN` in `apps/web/.env.local`, `apps/worker-ingestion/.env` and `apps/worker-generation/.env`.
4. Development mode delivers the upload completion callback locally, so no tunnel is needed.

### Upstash Redis (rate limits and caches)

1. Create one Redis database per environment in the region closest to Vercel and Neon, with **eviction enabled** (Section 23).
2. Copy the REST URL and token → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` in all three app env files.
3. Locally the Compose REST proxy is used: `http://localhost:8079` with the token from `infra/.env`.
4. Set `RATE_LIMIT_IP_SECRET` in `apps/web/.env.local` to a long random value outside development (`openssl rand -hex 32`).

### Inngest (durable workflows)

1. Create an Inngest account with a production environment and a branch/staging environment.
2. Copy the **Event Key** → `INNGEST_EVENT_KEY` (all three apps) and the **Signing Key** → `INNGEST_SIGNING_KEY` (both workers).
3. Confirm **Connect** is available on your plan. If it is not, the workers can run as Render web services exposing a signed `serve()` endpoint instead (Section 9); function code does not change.
4. Locally set `INNGEST_DEV=1` (already in the examples) and leave the keys empty; the workers connect to the Dev Server. Never set `INNGEST_DEV` in staging or production.

### Browserless (hosted Chromium for PDF rendering)

1. Create a Browserless cloud account and API token; choose the regional endpoint nearest your Render region (for example `wss://production-sfo.browserless.io`).
2. Set `BROWSERLESS_WS_ENDPOINT` and `BROWSERLESS_TOKEN` in both worker env files. Make sure the plan's concurrent-session limit covers both workers (Section 26).
3. Locally the Compose container is used (`ws://localhost:3001`, token from `infra/.env`).

### Jina AI (embeddings, reranker, Reader)

1. Create an API key at jina.ai → `JINA_API_KEY` (all three apps).
2. Models are configuration. Defaults: `JINA_EMBEDDING_MODEL=jina-embeddings-v5-text-small`, `JINA_EMBEDDING_DIMENSION=1024` (the v5 text models support up to 1024 dimensions), `JINA_RERANKER_MODEL=jina-reranker-v3.5`.
3. The embedding model and dimension must never change for an existing index without re-indexing (Section 8 step 6).

### Google Gemini

1. Create an API key in Google AI Studio → `GEMINI_API_KEY` (web and Worker B).
2. `GEMINI_CHAT_MODEL` and `GEMINI_GENERATION_MODEL` default to the pinned `gemini-3.6-flash`. Avoid aliases such as `gemini-flash-latest`: they move to the newest model, which can be overloaded (on 2026-10-30 it pointed at `gemini-3.8-flash` and returned 503 "high demand"). Google may also serve a newer model than the one requested (`gemini-3.5-flash` requests are served by `gemini-3.6-flash`), so AI runs record the response's `modelVersion` (Section 2). `pnpm check:services` fails if a configured model is not available to your key.
3. The free tier allows 5 generate requests per minute per model, which is enough for the smoke check but not for real use. Enable billing on the Google Cloud project behind the key before staging or production.

### Stripe (test mode)

1. Use a Stripe sandbox/test-mode account; copy the test secret key (`sk_test_…`) → `STRIPE_SECRET_KEY` in `apps/web/.env.local` and `apps/worker-ingestion/.env`.
2. Install the Stripe CLI and run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`; copy the printed `whsec_…` → `STRIPE_WEBHOOK_SECRET` (web).
3. The Pro product and monthly price are created in Phase 10 (`STRIPE_PRO_MONTHLY_PRICE_ID`).
4. Live payments need a supported business and account configuration; verify eligibility before promising a live Pakistan-based checkout (Section 10). The smoke check refuses live keys outside `APP_ENV=production`.

### PushEngage (opt-in browser notifications, optional)

PushEngage is not required in any environment. Without it, notifications are in-app only; it may be dropped from the project before Phase 6.

1. Create a PushEngage site for your local/staging domain.
2. Copy the API key (Site Settings → Site Details) → `PUSHENGAGE_API_KEY` (web and Worker A) and the public site key → `NEXT_PUBLIC_PUSHENGAGE_SITE_KEY` (web).
3. Phase 6 adds the browser SDK and PushEngage's service-worker file; push notifications stay optional for users.

## Verifying

`pnpm check:services` runs one check per service and prints `service | configured | result | detail`. Services without keys show "not configured" with the variables to set; configured services must pass. Run a subset with `--only=postgres,upstash,inngest,browserless,jina,gemini,uploadthing,stripe,auth0,pushengage`. The Inngest check needs both workers running (`pnpm dev`).
