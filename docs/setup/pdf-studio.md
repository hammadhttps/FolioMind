# PDF Studio

How a project becomes a PDF, what it needs, and what it costs.

## What happens

1. **Create a project** in My Projects, or with **Turn into a PDF** in a workspace. Nothing is charged yet.
2. **Generate an outline.** `POST /api/projects/:id/generate` reserves the allowance and writes the job and its event together. `generate-outline` retrieves evidence for the prompt and asks Gemini for a structured outline.
3. **Edit and approve it.** Nothing is drafted until **Approve & create draft**.
4. **The draft fills in.** `generate-draft` runs one step per section: retrieve evidence for that section, ask Gemini, map every `[S1]` to a real chunk and page, then save. A section the sources don't cover says so instead of guessing. When all are written, revision 1 is saved.
5. **Edit it.** The editor saves 1.2 seconds after typing. If another tab saved first, the owner chooses which text to keep, and the other is kept as a revision.
6. **Regenerate a section** if needed. `regenerate-section` saves a proposal shown beside the current text. Nothing changes unless the owner chooses it.
7. **Export.** `render-export` renders one exact, immutable revision through Browserless, counts its pages, stores it in UploadThing and notifies the owner.

Every delayed step re-checks the job, the owner and each source, so a deleted source or a cancelled job stops the run before it writes anything.

## Settings

All of these have working defaults.

| Variable                  | Default                 | Used for                                   |
| ------------------------- | ----------------------- | ------------------------------------------ |
| `GEMINI_GENERATION_MODEL` | `gemini-3.6-flash`      | Outlines and draft sections                |
| `GEMINI_FAST_MODEL`       | `gemini-3.5-flash-lite` | Used when the first model's quota is spent |
| `GENERATION_CONCURRENCY`  | `1`                     | Heavy runs at once, across all four        |

The four functions share one Inngest concurrency key, `worker-b-heavy`. Browserless must allow this many sessions plus `IMPORT_CONCURRENCY`, because exports and web imports both render. If it's full, the step retries with backoff.

## Gemini's free tier

The free tier allows **20 requests a day for each model, across the whole Google project**, shared with chat and with any local testing. A draft makes one request per section, and sometimes more:

| Length | Words (about) | Sections | Requests for outline and draft |
| ------ | ------------- | -------- | ------------------------------ |
| Short  | 800           | 3–5      | 4–6                            |
| Medium | 2,000         | 5–8      | 6–9                            |
| Long   | 4,000         | 8–15     | 9–16                           |

So that a draft can finish, each request tries `GEMINI_GENERATION_MODEL` first and `GEMINI_FAST_MODEL` once that model is out of quota. If both are out, the job fails with "FolioMind has used today's free AI requests", nothing is charged, and the sections already written stay. **Try again** the next day fills in the rest. Quotas reset at midnight Pacific time.

Turning on billing for the Google project lifts these limits.

## What each action spends

From Section 10 of the blueprint. Reservations are returned if a job fails or is stopped, so a retry never charges twice.

| Action                                | Spends                             |
| ------------------------------------- | ---------------------------------- |
| Creating a project                    | Nothing                            |
| First outline                         | 1 generated project                |
| First draft                           | Nothing: the same credit covers it |
| Generating the outline again          | 1 regeneration                     |
| Replacing a finished draft            | 1 regeneration                     |
| Regenerating a section                | 1 regeneration, even if declined   |
| First export of a project             | Nothing                            |
| Exporting a revision again            | Nothing: it hands back the file    |
| The same revision in another template | Nothing                            |
| Exporting edited text after an export | 1 re-export                        |
| Editing, downloading                  | Nothing                            |

A duplicated project has no credit of its own, so drafting it spends one.

## Deploying a schema change

Migration `0003_project_studio` adds columns the Studio reads and writes, and status checks on `projects` and `exports`. Apply it to Neon **before** deploying this code, following [Neon (staging and production)](database.md#neon-staging-and-production). It only adds, so the site that's already running keeps working.

If Inngest doesn't pick up the new functions after the deploy, run `curl -X PUT https://folio-mind-two.vercel.app/api/inngest`.

## Running it locally

Generation runs in the Docker-free worker:

```sh
pnpm stack:up
pnpm --filter worker-ingestion dev   # Worker A: uploads and notifications
pnpm --filter worker-generation dev  # Worker B: generation and export
pnpm --filter web dev
```

To avoid spending the requests the deployed site shares, start Worker B with `GEMINI_GENERATION_MODEL=gemini-3.5-flash-lite` for testing.

## Tests

- `pnpm --filter @foliomind/pdf test` renders both templates in the Browserless container and checks page count, embedded fonts and that nothing was fetched. It skips when the container isn't running.
- `pnpm --filter @foliomind/workflows test` runs all four functions on Postgres with Gemini and Jina mocked.
- `e2e/projects.spec.ts` covers the screens with seeded projects and needs no AI keys.
- `e2e/studio.spec.ts` is the real flow, with real uploads, Jina, Gemini and Chromium. It needs both workers.
