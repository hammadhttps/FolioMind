# Deployment

FolioMind runs on Vercel only. The web app serves pages, API routes and both background workers, which Inngest calls at `/api/inngest`. The database is Neon Postgres. Caches and rate limits live in Upstash, files in UploadThing, and billing runs in Stripe test mode. The Docker images in `infra/docker/` are built in CI to keep a portable path working; nothing deploys them.

## Environments

|                     | Development                      | Preview (staging)                                          | Production                                            |
| ------------------- | -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Where               | `pnpm dev` and the Compose stack | Vercel Preview deployments, one per branch or pull request | Vercel Production, `main`                             |
| `APP_ENV` (derived) | `development`                    | `staging` (from `VERCEL_ENV=preview`)                      | `production`                                          |
| Database            | Local Postgres                   | The Neon **`preview`** branch                              | The Neon **`main`** branch                            |
| Stripe              | Test mode                        | Test mode                                                  | Test mode until [go-live](../setup/stripe-go-live.md) |
| Cache keys          | `fm:development:…`               | `fm:staging:…`                                             | `fm:production:…`                                     |

Section 14 forbids previews from touching production data or live billing. Previews and production share the Upstash database, separated by the key prefix, and the Inngest account, separated by Inngest's branch environments for previews.

Staging and production builds stop when a required variable is missing (`PRODUCTION_REQUIRED.web` in `packages/contracts/src/env.ts`). Set the **Preview** scope as completely as Production.

## A preview database on its own Neon branch

Do this once, in the Neon console:

1. **Create the branch.** Go to **Branches → New branch**, name it `preview` and use `main` as the parent. If **Schema only** is offered, choose it: the branch then starts with the tables and none of the data. Otherwise the branch starts as a full copy of production. Empty it before any preview uses it: run `drop schema public cascade; create schema public;` on the `preview` branch only, checking the branch name in the console first. Then follow step 3.
2. **Roles.** The branch inherits the owner and `foliomind_app` roles and their passwords. Reset the `foliomind_app` password on the branch so a leaked preview string can't open production.
3. **Schema and seed.** From a terminal, with `DIRECT_DATABASE_URL` set to the branch's direct host (no `-pooler`, no `channel_binding`):

   ```bash
   pnpm db:migrate && pnpm db:roles && pnpm db:seed
   ```

   Add `DATABASE_RUNTIME_PASSWORD` for `db:roles` and `STRIPE_PRO_MONTHLY_PRICE_ID` for `db:seed`. Never put production users or content on this branch.

4. **Vercel.** Under **Settings → Environment Variables**, set the **Preview** scope only: `DATABASE_URL` is the branch's pooled host with the `foliomind_app` role, and `DIRECT_DATABASE_URL` is the branch's direct host. Production keeps its own values.
5. **Auth0.** Signing in on a preview needs that preview's URL in the application's Allowed Callback URLs, Logout URLs and Web Origins. Use the stable branch URL Vercel shows for a branch, and add it explicitly.
6. **Stripe.** Previews use the test key. No webhook endpoint points at previews, so a test upgrade on a preview stays in Payment pending until the hourly `reconcile-billing` runs there, if Inngest runs that preview's functions.

New migrations reach the `preview` branch the same way (step 3) before a preview that needs them is opened.

## The pipeline

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

| Job                              | What it proves                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, test, build     | Frozen install, ESLint, TypeScript, unit and component tests, the production web build, the route trace check                                                                   |
| Local service smoke checks       | Postgres, the Upstash proxy and Browserless answer; both PDF templates render in Chromium                                                                                       |
| Migrations and integration tests | Every committed migration applies to an empty pgvector database; the schema matches its migrations; domain, workflow, chat and rate-limit tests pass on real Postgres and Redis |
| Build images                     | The web, ingestion, generation and migrate images build; Worker A boots and stops cleanly on SIGTERM                                                                            |
| End-to-end journeys              | The production web build against the Compose stack, in Playwright at 1440 and 390 px. Journeys needing provider keys or a connected worker skip with a reason                   |
| Migrate, deploy and smoke-test   | On `main` only, after every job above passes, and only once switched on (below)                                                                                                 |

Actions are pinned to commit SHAs and base images to digests. Update a pin by changing the SHA or digest together with the version comment beside it.

### Gated deploys (not switched on yet)

Today Vercel deploys `main` from its own Git integration as soon as a commit lands, whether or not CI passes. To make CI the only path to production:

1. **GitHub secrets** (**Settings → Secrets and variables → Actions**):
   - `VERCEL_TOKEN`: a Vercel access token scoped to the team
   - `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`: from `.vercel/project.json` after `pnpm dlx vercel link` in the repo root
   - `NEON_DIRECT_DATABASE_URL`: Neon `main` branch, direct host, owner role (no `-pooler`, no `channel_binding`)
2. **GitHub variables:** `PRODUCTION_URL` = `https://folio-mind-two.vercel.app` and `CI_DEPLOY` = `true`.
3. **Stop Vercel's own production deploys.** Add `apps/web/vercel.json` with `{ "git": { "deploymentEnabled": { "main": false } } }`. Preview deployments for other branches continue.
4. **Protect `main`.** Require the CI checks on pull requests.

The deploy job then runs, in order:

1. `pnpm db:migrate` against Neon. This is the only place migrations run.
2. `vercel build --prod`, then `vercel deploy --prebuilt --prod`.
3. A PUT to `/api/inngest`, so new functions register.
4. `pnpm smoke -- $PRODUCTION_URL`: public pages, the guest redirect, the manifest, the unsigned webhook refused with a 400, and Inngest's route served.

Until then, deploy by hand in the same order: migrate Neon (see [database.md](../setup/database.md)), push to `main`, sync Inngest, then run `pnpm smoke -- https://folio-mind-two.vercel.app`.

## Rolling back

- **Code.** Vercel keeps every production deployment. Go to **Deployments**, pick the last good one and choose **Instant Rollback**, or promote it. This takes seconds and doesn't rebuild.
- **Schema.** A rollback never undoes a migration. Migrations follow expand, migrate, contract: add new columns and tables first, ship code that works with both shapes, and remove the old shape only in a later release. The previous deployment then still runs against the newer schema.
- **Data.** Restore from Neon's history: see the [runbook](runbook.md#restoring-the-database).
- **Images.** CI builds them without pushing. If a container host is ever used, keep earlier tags so a rollback is a redeploy of the previous tag.
