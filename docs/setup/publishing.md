# Publishing, catalog and moderation

How a book reaches the public library, what admins do, and what has to be in place on the live site.

## Before the first deploy with publishing

1. **Migration `0004`** must be on Neon before the code that uses it. It is additive: an optional end date for suspensions, report details, one open revision per book, one open report per reader and book, a slug check and two admin indexes. Run it the same way as the earlier ones (`docs/setup/database.md`), with `DIRECT_DATABASE_URL` pointing at Neon's direct host.
2. **No new environment variables.** Book files use the same `UPLOADTHING_TOKEN`; caches and rate limits use the same Upstash database.
3. **Sync Inngest after the deploy.** Worker A gains `notify-followers`, so `foliomind-ingestion` should list eleven functions. If the integration doesn't sync on its own:

   ```bash
   curl -X PUT https://folio-mind-two.vercel.app/api/inngest
   ```

4. **An admin account.** Admin is granted only by the audited script (Section 4): sign in once on the live site, then run `pnpm promote-admin <email> --reason "…"` against Neon. Administrator accounts can't publish; use a separate reader account to try the publisher side.

## The journey

1. **Apply.** A reader with a verified email opens **Publishing** and sends an application: publisher name, page address (`/publishers/<address>`), biography, optional website and the rights statement. Five applications or reports an hour per account.
2. **Approve.** An admin opens **Admin → Applications** and approves, which grants the `publisher` role, or rejects with a reason the applicant sees. A rejected applicant can apply again. Publishers don't get Pro.
3. **Add a book.** **Submit a publication** takes a title and the PDF. The PDF goes through the same ingestion as uploads; the editor shows its progress.
4. **Fill in the listing.** Author, description (50–3,000 characters), language, 1–3 categories, license statement (20–1,000) and an optional cover. **Save draft** keeps unfinished work; **Submit for review** checks every field, needs the PDF processed and the rights box ticked.
5. **Review.** **Admin → Moderation** lists waiting submissions oldest first. **Review** shows the details, the cover and **Open the PDF** (only submitted, public-bound PDFs open there; never anyone's private uploads). **Approve** makes it live at once; **Reject** needs a reason, which the publisher sees, and leaves any live version as it was.
6. **Revise.** After a rejection, or to update a live book, **Revise** / **Edit listing** starts a new revision from the last one. A new PDF is allowed there too. Readers keep seeing the approved revision until the new one is approved.
7. **Unpublish** takes a live book out of the library; returning it needs another review. A draft that was never published can be deleted.

Approval, unpublishing and takedown bump the catalog cache version in Upstash and expire the `catalog`, `book:{id}` and `publisher:{slug}` tags, so the change shows on the next request. Takedown and unpublishing also end reading access at once, because every read checks that the book is published.

## Limits

Book files don't count toward the publisher's own plan (user decision, 2026-11-09). Instead each publisher has:

| Limit                                | Value   |
| ------------------------------------ | ------- |
| Books that aren't deleted or removed | 20      |
| Book PDFs and covers stored          | 250 MiB |
| Book files uploaded per 24 hours     | 10      |
| PDF size (same as uploads)           | 20 MiB  |
| Cover image (JPEG, PNG or WebP)      | 4 MiB   |

Replacing a draft's PDF or cover frees the old file unless an earlier revision still uses it.

## Readers

- **Explore** (`/library`) searches titles, authors and descriptions (title weighs most) with full-text search, and falls back to typo-tolerant matching when nothing matches. Filters are categories, language and publisher; sorts are newest, title and relevance. Pages hold 24 books, up to page 100.
- **Book Details** shows the listing and its license, with **Start reading**, **Save to library** and **Report a concern**. Saved books appear in My Library, where removing one removes only the save.
- **Publisher pages** show the biography, website, books and **Follow publisher**, with a switch for notices about new books.
- Readers count once per reader, book and day; saves once per reader, book and day. Publishers see totals for the last 30 days and their follower count, never who read or what anyone asked.

## Moderation and reports

- **Reports** come from Book Details: a reason, and details (required for "Something else"). Moderators don't see who reported. Each report can be resolved, dismissed, or the book taken down.
- **Take down** removes the book from the library and from reading at once, resolves its open reports with the same reason, rejects anything waiting, and tells the publisher. A removed book can't be revised.

## Admin overview

- **Health:** jobs by kind and status over seven days, the oldest waiting job, recent failures with their safe error codes, undelivered events and the webhook backlog, with a link to Inngest. **Retry** re-runs a failed upload, import or export as a new job through the owner's own path, so allowances and notices are never doubled. Generation is retried by the owner in PDF Studio.
- **Users:** search by email or name, filter by role, status and plan. **Suspend** needs a reason and can end on a date; it signs the person out at once. Administrator accounts and your own can't be suspended here.
- **Usage:** AI runs, tokens and estimated cost by day and purpose, and this month's allowances across accounts. No prompts or text.
- **Audit:** every admin decision, publisher action and suspension, filterable by action, person or target and date.

## Check that it's working

1. As an admin, open **Admin**: the four numbers should be real counts, and **Health** should list recent jobs.
2. From a reader account, apply on **Publishing**; approve it under **Admin → Applications**.
3. Add a small PDF as a book, fill in the listing once it's processed, and submit. Approve it in **Moderation**.
4. Sign out: the book should appear in **Explore** and on its publisher's page. Signed in again, save it and open it.
