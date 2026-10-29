# FolioMind

FolioMind helps students, researchers and independent publishers organize documents, understand their contents, compare sources and create polished PDFs. Readers upload course material, ask questions with page citations, combine several sources in a research workspace, approve an outline, edit an AI generated draft and export a report. Publishers can submit authorized books for a moderated public catalog.

## Repository layout

| Path                     | Contents                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `apps/web`               | Next.js application                                                                   |
| `apps/worker-ingestion`  | Worker A: ingestion, web import, notifications, billing sync, cleanup                 |
| `apps/worker-generation` | Worker B: outline/draft generation and PDF export                                     |
| `packages/*`             | Shared `@foliomind/*` packages: `db`, `domain`, `contracts`, `ai`, `pdf`, `workflows` |
| `infra`                  | Dockerfiles and (from Phase 2) the local Docker Compose stack                         |

## Prerequisites

- Node.js 24 LTS (`.nvmrc`); at least 20.9
- pnpm through Corepack (`corepack enable pnpm`; the version is pinned in `package.json`)
- Docker Desktop (local services from Phase 2, image builds)

## Commands

| Command                                         | What it does                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                  | Install all workspaces                                                                                                                                              |
| `pnpm dev`                                      | Run the web app (<http://localhost:3000>) and both workers                                                                                                          |
| `pnpm build`                                    | Build every app                                                                                                                                                     |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`    | Quality checks across the monorepo                                                                                                                                  |
| `pnpm e2e`                                      | Playwright end-to-end tests (first run: `pnpm --filter web exec playwright install chromium`, or set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Google Chrome) |
| `pnpm format` / `pnpm format:check`             | Prettier                                                                                                                                                            |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle migrations (schema arrives in Phase 4)                                                                                                                      |
| `pnpm stack:up` / `stack:down`                  | Local Docker services (arrive in Phase 2)                                                                                                                           |
