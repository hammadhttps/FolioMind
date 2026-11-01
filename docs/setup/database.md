# Database setup

FolioMind keeps all application data in PostgreSQL with the `vector` and `pg_trgm` extensions: the local Compose database in development, and Neon in staging and production. The schema lives in `packages/db/src/schema/`, and the committed SQL migrations in `packages/db/migrations/`.

## Two database roles

| Role                                | Used by                                     | Variable                                   | Can do                                                                                                 |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Migration role (the database owner) | Migrations, seeds, `promote-admin`, workers | `DIRECT_DATABASE_URL` (direct, not pooled) | Everything, including schema changes                                                                   |
| Runtime role `foliomind_app`        | The web app                                 | `DATABASE_URL` (pooled)                    | Read and write rows only. It cannot change the schema, and it cannot edit or delete `audit_logs` rows. |

`pnpm db:roles` creates or updates the runtime role and applies its grants. It is safe to run any number of times; run it after every migration.

## Local development

1. Start the stack: `pnpm stack:up`.
2. Set up the database: `pnpm db:setup`. This applies migrations, creates `foliomind_app` (local password `foliomind_app`) and seeds the plans and categories.
3. Optional sample catalog: `pnpm db:seed:dev`. This adds one sample publisher and three books whose titles start with "Sample". It refuses to run with `NODE_ENV=production`, with `APP_ENV=staging` or `production`, or against any database that isn't on your machine.
4. `apps/web/.env.local` must use the runtime role:
   `DATABASE_URL=postgres://foliomind_app:foliomind_app@localhost:5433/foliomind`

All database commands use `DIRECT_DATABASE_URL`. When it isn't set, they use the local Compose database.

To run the same setup inside a container, the way a deployment runs it, use `pnpm stack:migrate`. It builds `infra/docker/Dockerfile.migrate` and runs migrate, roles and the required seed once.

## Changing the schema

1. Edit the tables in `packages/db/src/schema/`.
2. Run `pnpm db:generate --name <what_changed>`.
3. Read the generated SQL in `packages/db/migrations/`. Add by hand only what Drizzle can't express, and do it before the migration is applied anywhere.
4. Run `pnpm db:migrate`, then `pnpm db:roles`.
5. Never edit a migration that has already been applied anywhere. Write a new one instead, using expand, migrate, contract for breaking changes (Section 14).

CI applies the committed migrations to an empty pgvector database. It fails if the schema has changes that aren't in a committed migration.

## Neon (staging and production)

Run these steps on each Neon branch, from your own machine. Keep the connection strings in your shell or a git-ignored file, never in the repository.

1. **Apply the migrations.** Use the owner role's direct connection string (no `-pooler` in the host):
   ```sh
   DIRECT_DATABASE_URL='postgresql://neondb_owner:…@ep-….neon.tech/neondb?sslmode=require' pnpm db:migrate
   DIRECT_DATABASE_URL='…same…' pnpm db:seed
   ```
   In PowerShell, set the variable first: `$env:DIRECT_DATABASE_URL = '…'`.
2. **Create the runtime role.** Choose a long random password, then run:
   ```sh
   DIRECT_DATABASE_URL='…owner, direct…' DATABASE_RUNTIME_PASSWORD='…long random…' pnpm db:roles
   ```
   If you'd rather create `foliomind_app` in the Neon console, create it there first, then run `pnpm db:roles` without `DATABASE_RUNTIME_PASSWORD`. It will only apply the grants.
3. **Point the web app at the runtime role.** In Vercel, set `DATABASE_URL` to the pooled connection string for `foliomind_app`, then redeploy. Until you do, the web app keeps working with the owner role; it just has more privileges than it needs.
4. **Every time a release adds a migration,** repeat steps 1 and 2 before the new code deploys. The web app needs the new tables as soon as it starts.

## Admin accounts

Admin is granted only by a script, and every grant is written to the audit log (Section 4). The person must have signed in once first:

```sh
pnpm promote-admin person@example.com --reason "Founding admin"
```

The script uses `DIRECT_DATABASE_URL`, the same as the migrations. The new role applies on the person's next request. If `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, the cached snapshot is dropped immediately; otherwise it expires within 60 seconds.
