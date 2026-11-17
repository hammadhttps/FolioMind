# Data retention policy

> **Draft for the owner to review (written 2026-11-15).** This describes what the
> code does today. It is not legal advice. Before launch, settle the open decisions
> at the end, have the text reviewed, and update the public page at
> `/privacy/retention` (`apps/web/app/(public)/privacy/retention/page.tsx`) to match.
> If this policy changes, change the code with it.

## Principles

1. Data with no purpose is deleted. Only billing and audit records the law or
   security needs are kept, and those keep no name, email or private content.
2. Deleting something revokes access at once. Removing stored copies follows in
   the background, and the daily cleanup retries whatever fails.
3. Nothing is resurrected: jobs refuse deleted records, and caches are invalidated
   on deletion.
4. A PDF someone has already downloaded can't be recalled.

The background work runs in Worker A's `cleanup-maintenance` function, daily at
03:30 UTC (`packages/workflows/src/functions/ingestion/control.ts`).

## Deleting a document or a project

| What                                                   | When it goes                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Access to the document, in the reader, chat and search | Immediately                                                                                           |
| Page text, chunks and embeddings                       | Next daily cleanup (`purgeDeletedDocuments`)                                                          |
| The stored file in UploadThing                         | Next daily cleanup (`filesToDelete`)                                                                  |
| Document and version rows                              | Kept as tombstones, so earlier citations keep a title and page label                                  |
| A deleted project                                      | Hidden immediately; its rows are removed by the daily cleanup after 24 hours (`purgeDeletedProjects`) |

## Deleting an account

A user deletes their account in Settings after typing the confirmation phrase and
signing in within the last 10 minutes. Administrator accounts must first lose the
admin role through the audited process. Implementation:
`packages/domain/src/account/index.ts` and `apps/web/lib/account/deletion.ts`.

### Removed immediately, in one transaction

- The account is marked `deleting`. Every request and sign-in refuses it from then on.
- Documents and projects are revoked. Queued and running jobs are cancelled, and
  unused upload slots are expired.
- Library items, collections, highlights and notes, reading progress,
  conversations with their messages and citations, research workspaces, publisher
  follows, notifications and push devices are deleted.
- Published books are unpublished and leave the library. A pending submission
  returns to draft, and the publisher profile is suspended.
- Every stored file (uploads, imports, exports, covers, avatar) is queued for deletion.

### Removed right after the response, retried daily

| What                       | How                                                                            |
| -------------------------- | ------------------------------------------------------------------------------ |
| Stored files               | Deleted from UploadThing                                                       |
| A live Stripe subscription | Cancelled at once, without proration or a final invoice, so it can never renew |
| The Auth0 identity         | Deleted through the Management API (a 404 counts as done)                      |

### Kept, anonymized

When the identity, any live subscription and every file are gone, the daily
cleanup anonymizes the user row. The name becomes "Deleted account" and the email
`deleted-{id}@deleted.invalid`. The avatar is removed, linked sign-in methods and
preferences are deleted, and the Auth0 reference becomes `deleted|{id}`.

The anonymized row stays only because the records below point to it:

| Record                                                                               | Kept for                                | Contents                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------- |
| Billing: the Stripe customer mapping, subscriptions, invoice summaries, usage counts | The accounting period (open decision 1) | Stripe IDs, amounts, dates, statuses, counts      |
| Audit log entries                                                                    | Open decision 2                         | Action, IDs, counts and codes, never private text |
| Book records and the suspended publisher profile                                     | Open decision 3                         | Title, author, description, moderation history    |
| Stripe's own customer and invoices                                                   | Stripe's retention (open decision 4)    | Held in Stripe, not in FolioMind                  |

## Routine retention

| Data                                                          | Rule                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Notifications                                                 | Deleted after 90 days (`NOTIFICATION_RETENTION_DAYS`)                                                                              |
| Stripe webhook records                                        | Payload minimized on arrival to `{created, livemode, customerId}`; deleted after 30 days                                           |
| Uploads that never completed                                  | Files removed after a day                                                                                                          |
| Expired upload slots                                          | Deleted after 365 days                                                                                                             |
| Jobs, AI run cost records, outbox events, daily book counters | No automatic expiry yet. They hold IDs, statuses, safe error codes, token counts and counts, never document text (open decision 5) |

## Backups

Neon keeps database history for the restore window of the project's plan (check
the project settings). Data deleted from FolioMind leaves the backups when that
window passes. UploadThing keeps no copies after a file is deleted.

## Open decisions for the owner

1. **Billing records:** how long the law in the business's jurisdiction requires
   invoices and payment records to be kept (often 5 to 10 years). After that,
   delete the local rows and the Stripe customer.
2. **Audit log:** a retention period, for example 2 years, and a scheduled purge.
3. **A deleted publisher's books:** keep them unpublished (today's behavior), or
   delete or anonymize the book and profile rows once moderation needs end.
4. **The Stripe customer:** whether to delete it in Stripe at the end of the
   billing-record period (see 1).
5. **Operational records:** periods for jobs, AI run records and outbox events
   (for example 90 days), then a scheduled purge.
6. **Refunds:** cancelling at deletion doesn't refund the current period. Decide
   whether to refund unused time.
