# Runbook

What to watch, what to do when something breaks, and how to restore data. Production is `https://folio-mind-two.vercel.app` ([deployment.md](deployment.md)).

## Where to look

| Signal (Section 14)                  | Where                                                                                                            | Worry when                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Failed jobs, oldest queued job       | **Admin → Health**: "Failures, last 24 h" and "Oldest queued job"                                                | Failures in the last 24 hours rise; a job queued for more than 15 minutes       |
| Outbox backlog                       | Admin → Health: "Undelivered events"                                                                             | The oldest pending event is over 10 minutes old                                 |
| Stripe webhook backlog               | Admin → Health: "Webhook backlog"; Stripe → Developers → Webhooks → Event deliveries                             | Anything unfinished for over 15 minutes; any non-2xx delivery                   |
| Inngest backlog age and failure rate | Inngest dashboard → the `foliomind-ingestion` app → Functions and Runs                                           | More than 5 % of runs failing in an hour; runs waiting for over 15 minutes      |
| Connected workers                    | Inngest → Apps: the app synced, with its function count (13 for `foliomind-ingestion` after Phase 10)            | Not synced after a deploy, or a function missing                                |
| Token costs                          | Admin → Usage: AI calls and cost "By day and purpose"                                                            | A day costs well above the 7-day average                                        |
| Rate-limit rejections                | Upstash console → the database → Rate limit analytics (the limiters record analytics); 429s in Vercel → Logs     | A sudden jump: an attack, or a limit set too low                                |
| Cache hit rate                       | Upstash console → Usage (commands, hits)                                                                         | Hits collapse after a deploy (key prefix or schema version changed)             |
| Provider errors                      | Vercel → Logs, filter by `level: error` and by event (`billing.*`, `auth.*`, `upload.*`, `background-functions`) | Repeated `provider_unavailable` or 5xx from Gemini, Jina, UploadThing or Stripe |
| Browserless usage                    | Browserless account → Usage                                                                                      | Near the plan's monthly units                                                   |
| Database connections, storage        | Neon console → Monitoring                                                                                        | Connections over 80 % of the compute's limit; storage over 80 % of the plan     |
| Storage of files                     | UploadThing dashboard → Usage                                                                                    | Over 80 % of the plan                                                           |
| p95 response time                    | Vercel → Observability (or Speed Insights)                                                                       | Page routes' p95 above 2 seconds                                                |

The free plans in use don't send alerts for most of these. Check Admin → Health and the Inngest dashboard daily, and turn on email notifications where a provider offers them on the current plan (Vercel deployment failures, Neon usage limits, Stripe webhook failures).

Every structured log line carries `event`, `level` and `release`: the first 12 characters of the deployed commit. Log lines never contain document text, prompts, emails or tokens. Filter by `release` to compare before and after a deploy.

## Incident basics

1. **Size it.** Who is affected: everyone, one feature, one user? Is data at risk, or only availability?
2. **Stop the damage first.** Roll back the deployment ([deployment.md](deployment.md#rolling-back)) if the last deploy caused it. Suspend an abusive account from Admin → Users.
3. **Find the cause** with the signals above and the release ID in the logs.
4. **Fix and verify.** Run `pnpm smoke -- https://folio-mind-two.vercel.app` after any production change.
5. **Write it down:** what happened, when, the cause and the follow-up. Add it to this file if the steps would help next time.

## Common problems

### Documents stuck in Processing

1. Admin → Health: find the job in "Jobs in the last 7 days", with its phase and safe error code.
2. Inngest → Runs for `ingest-document`: the failing step and its error.
3. If a provider was down, the user's **Retry** in My Library starts a fresh job once it's back. Inngest's own retries have usually tried 3 times already.
4. A job whose run vanished is requeued by `dispatch-outbox` (its `requeue-stalled-ingestion` step).

### Retrying background work

- **One failed run:** Inngest → the run → **Rerun**. Functions are idempotent through their operation keys, so a rerun never charges twice or duplicates output.
- **Many failed runs after an outage:** Inngest → the function → **Replay** for the failure window.
- **Events that never left the database:** `dispatch-outbox` (on `OUTBOX_DISPATCH_CRON`) resends pending events. Invoke it from the Inngest dashboard to run it at once.

### Replaying Stripe webhooks

Stripe retries failed deliveries for up to three days. To resend one now:

- **Dashboard:** Developers → Webhooks → the endpoint → the event → **Resend**.
- **CLI:** `stripe events resend evt_… --webhook-endpoint we_…`.

Repeats are harmless: the route records each event ID once, and `sync-stripe` rebuilds from Stripe's current state. To re-sync every stale customer without waiting for the hour, invoke `reconcile-billing` from the Inngest dashboard. One customer stuck in Payment pending is usually fixed by either.

### Redis (Upstash) is down

Caches miss and fall back to Postgres. Rate limits follow their class policy (Section 23, `RATE_LIMIT_CLASSES` in `apps/web/lib/rate-limit/core.ts`). Most classes fail open, because Postgres quotas still bound the cost. Four fail closed and refuse until Redis returns: web article imports, billing sessions (Checkout and Portal), reports and publisher applications, and account security (linking, unlinking, deletion). Nothing needs replaying afterwards.

### The database is down

Pages fail, and the webhook route answers 503, so Stripe retries later. UploadThing retries its completion callback, and Inngest retries steps. When Neon is back, check "Webhook backlog" and "Undelivered events" in Admin → Health. Both drain on their own; replay as above if something stays stuck.

### AI or PDF providers are down

Chat says answers are unavailable; ingestion and generation steps retry with backoff, then fail with a safe code that users can retry. Gemini, Jina and Browserless errors show in the logs as `provider_unavailable`. Nothing to clean up afterwards.

### An account deletion didn't finish

```sql
select id, auth0_sub like 'deleted|%' as identity_gone, updated_at
from users where status = 'deleting' and deleted_at is null;
```

The daily cleanup retries cancelling the Stripe subscription, deleting the Auth0 identity and deleting files, then anonymizes the row. If a row stays for several days, check the Auth0 Management credentials (`AUTH0_MGMT_*`) and the Stripe key. Never leave a renewing subscription: cancel it in the Stripe Dashboard if needed.

### A secret leaked

Rotate it at the provider first. Then update it in Vercel (Production and Preview) and in local env files, and redeploy:

- **Neon:** reset the role's password.
- **Stripe:** roll the key, or for a webhook, roll the endpoint's signing secret.
- **Auth0:** rotate the client secret.
- **UploadThing, Upstash, Inngest, Jina, Gemini:** regenerate the token or key.

## Restoring the database

Neon keeps history for the restore window of the project's plan. A restore never touches production until the copy has been checked.

1. **Copy the past.** In the Neon console, go to **Branches → New branch**, pick `main` as the parent and choose **Past data** at a time just before the problem. Name it `restore-YYYYMMDD-HHMM`.
2. **Check the copy.** Connect to the new branch, using its own connection string, and confirm the missing or damaged rows look right there.
3. **Choose the repair:**
   - **A few rows:** copy them from the restore branch into `main` with reviewed SQL.
   - **Everything:** **Restore** `main` to that time from the branch page. Neon keeps the pre-restore state as a backup branch. Writes made after that time are lost, so note them first.
4. **Afterwards:** run `pnpm smoke` and check Admin → Health. Then let `reconcile-billing` re-sync Stripe state, since local billing rows may be older than Stripe's. Delete the restore branch when done.

### Restore rehearsals

| Date              | Restored to | Branch | Checks | Time taken | Result |
| ----------------- | ----------- | ------ | ------ | ---------- | ------ |
| Not yet performed |             |        |        |            |        |
