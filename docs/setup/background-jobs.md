# Background jobs on Vercel

FolioMind's background jobs process uploaded PDFs, import web articles, write PDF Studio's outlines and drafts, render exports, write in-app notifications and run the outbox and cleanup sweeps (blueprint Section 9). They run on Vercel, in the same project as the website, so there is no separate server to host or pay for.

## How it works

Nothing stays running between jobs. **Inngest** decides what should run next and calls `/api/inngest` on the site, once per batch of steps. Each call does some work, saves its progress to Postgres and Inngest, and ends. If a call fails, Inngest retries that step without repeating the finished ones.

The route only accepts requests signed with `INNGEST_SIGNING_KEY`. PDFs are parsed in a separate process that has no access to the site's secrets, with a memory cap and a time limit.

## Setup

The Vercel project already has the Inngest, UploadThing, Jina and Neon settings, so PDF processing needs nothing new. **Web article imports** need one free account:

1. Create a free account at browserless.io. The dashboard shows your API token and a regional address such as `wss://production-sfo.browserless.io`.
2. In Vercel, open the **folio-mind** project, then **Settings → Environment Variables**, and add these for Production:
   - `BROWSERLESS_WS_ENDPOINT`: the `wss://…` address
   - `BROWSERLESS_TOKEN`: the token
3. Redeploy: on **Deployments**, open the latest one's **⋯** menu and choose **Redeploy**.

Without these two values, importing an article fails with "We couldn't make a PDF of that page.", and exporting a project fails with "We couldn't render this PDF." Uploads and everything else keep working.

Exports and imports both open Browserless sessions. Browserless's plan must allow `GENERATION_CONCURRENCY` (default 1) plus `IMPORT_CONCURRENCY` (default 2) at once; when it's full, the step waits and retries.

## Check that it's working

- **Inngest dashboard:** in the **Production** environment, open **Apps**. `foliomind-ingestion` should be listed, with ten functions: Worker A's six and PDF Studio's four (`generate-outline`, `generate-draft`, `regenerate-section`, `render-export`). Inngest also lists each one's failure handler.
- **On the site:** upload a small PDF. The card should go from **Processing** through its phases to **Ready**, and the bell should show "Your PDF is ready to read."

## After changing the functions

Inngest needs to learn about added or changed functions. If its Vercel integration doesn't sync on its own after a deploy (Vercel's deployment protection can block it), sync by hand:

```bash
curl -X PUT https://folio-mind-two.vercel.app/api/inngest
```

The route uses its own server-side keys, and running it again is harmless.

## Free-plan limits to keep in mind

| Service      | Free allowance                                                                              | What FolioMind uses                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vercel Hobby | 300 seconds per call; 4 CPU-hours a month, shared with the website; non-commercial use only | One call stops starting new steps after 60 seconds. Parsing a 33-page PDF took about 3 CPU-seconds in testing. |
| Inngest      | 50,000 executions a month                                                                   | The hourly sweep uses about 2,200 a month, and each document about 8–12                                        |
| Neon         | 100 compute hours (CU-hours) a month; the database sleeps after 5 idle minutes              | The hourly sweep uses about 15 (at 0.25 CU)                                                                    |

Scheduled work is deliberately infrequent. Each sweep wakes the database, and running out of Neon's allowance suspends it until the next billing period. The web app sends each event as soon as it's saved, so the hourly sweep only recovers failures. It also re-queues uploads that never started, so a document can take up to about two hours to recover from a failed sync.

## Local development

`pnpm dev` runs the same functions in the Docker-free workers (`apps/worker-ingestion` and `apps/worker-generation`), connected to the local Inngest Dev Server. Nothing extra is needed. [PDF Studio](pdf-studio.md) explains how to keep local testing from spending the Gemini requests the live site shares.

## If it ever outgrows Vercel

The functions don't depend on where they run. `docs/setup/render-worker.md` and `infra/render.yaml` describe running them as a paid Docker worker on Render instead.
