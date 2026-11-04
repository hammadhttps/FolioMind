# Worker A on Render

Worker A (`foliomind-ingestion`) is the background service that processes documents. It extracts, chunks, embeds and indexes PDFs, imports web articles, sends in-app notifications and runs the outbox and cleanup sweeps (blueprint Section 9). It runs as a Docker **background worker** on Render. It connects out to Inngest Cloud through Inngest Connect, so it needs no public address.

Until Worker A is running, documents on the live site stay **Processing**.

## What it costs

- **Render:** background workers have no free plan. The smallest instance (`0.5c-512mb`, 0.5 CPU, 512 MB) costs about $7 a month; check the price Render shows when you create the service.
- **Inngest:** the free plan includes 50,000 executions a month and 3 worker connections. The outbox sweep runs every 10 minutes (about 8,600 executions a month), and each document costs roughly 8–12 executions.
- **Browserless:** used only for web article imports. The free plan is enough to start.
- **Jina:** embeddings and Reader use the same key as local development.

## Before you start: collect these values

Don't paste any of these into chat. They go straight into Render's form.

| Variable                                             | Where to find it                                                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DIRECT_DATABASE_URL`                                | Neon: your project, **Connect**, with **Connection pooling turned off**. Paste only the `postgresql://…` address, without `psql` or quotes.               |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash console: your database, **REST API**. In Vercel these are named `KV_REST_API_URL` and `KV_REST_API_TOKEN`.                                        |
| `INNGEST_EVENT_KEY`                                  | Inngest dashboard: **Production** environment, **Manage**, **Event Keys**.                                                                                |
| `INNGEST_SIGNING_KEY`                                | Inngest dashboard: **Production** environment, **Manage**, **Signing Key**.                                                                               |
| `UPLOADTHING_TOKEN`                                  | The same value as the Vercel Production `UPLOADTHING_TOKEN`: UploadThing dashboard, your app, **API Keys**, then the **UPLOADTHING_TOKEN** tab.           |
| `JINA_API_KEY`                                       | jina.ai: your account, **API keys**.                                                                                                                      |
| `BROWSERLESS_WS_ENDPOINT`, `BROWSERLESS_TOKEN`       | Browserless: create a free account. The dashboard shows your API token and the regional WebSocket address, such as `wss://production-sfo.browserless.io`. |

## Create the service

1. Sign in at render.com and connect your GitHub account, giving Render access to the FolioMind repository.
2. Click **New** and choose **Blueprint**. Pick the FolioMind repository and set **Blueprint Path** to `infra/render.yaml`.
3. Render lists one service, `foliomind-ingestion`, and asks for every secret variable. Paste each value from the table above, without quotes or spaces.
4. Click **Apply**. The first Docker build takes several minutes.
5. Open the service's **Logs**. You should see `worker booted` and then `connected to Inngest`. If you see `Invalid or missing environment variables`, the log lists the variable names to fix.

## Check that it's connected

1. In the Inngest dashboard (**Production**), open **Apps**. `foliomind-ingestion` should be listed as connected, with six functions.
2. On folio-mind-two.vercel.app, upload a small PDF. Within a minute or two the card goes from **Processing** (with its phases) to **Ready**, and the bell shows "Your PDF is ready to read."

## Documents uploaded before the worker existed

Uploads from before Worker A was running were announced to Inngest when no worker could receive them, so they stay **Processing**. Re-queue them once from your computer:

```bash
# PowerShell
$env:DIRECT_DATABASE_URL="<Neon direct connection string>"; pnpm requeue-ingestion
```

The script replaces each stalled job with a new one, and the worker's outbox sweep picks them up within 10 minutes. Running it again is harmless.

## Later changes

- **Redeploys** happen automatically when CI passes on `main` and worker files changed (`autoDeployTrigger: checksPass`).
- **Variables:** change them in the service's **Environment** tab. Render restarts the worker.
- **Memory:** if large PDFs fail with "This PDF took too long to read", move the service to `1c-2g` and raise `EXTRACTION_MEMORY_MB` to `1024`.
- **Orphan sweep:** keep `ORPHAN_FILE_SWEEP=0` while local development and production share one UploadThing app. Otherwise the daily cleanup in one environment could delete the other's files. Set it to `1` once production has its own app.
