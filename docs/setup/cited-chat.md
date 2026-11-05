# Cited chat and Research Workspaces

How questions get answered, what they need, and how to measure retrieval quality.

## What a question does

1. `POST /api/chat` checks the session, the chat rate limit (10 a minute and 100 an hour), the input and access to the document or workspace, then reserves one question from the month's allowance.
2. A follow-up is rewritten into a standalone question, if it needs it. This is the only step that reads earlier messages, and its result can't change which documents are searched.
3. Jina embeds the question. Postgres finds up to 20 passages by meaning and up to 20 by words, inside the versions this user may read right now.
4. Jina reranks the best 30, and up to 8 passages go to Gemini.
5. Gemini's answer streams to the browser. Then the question and answer are saved, every citation is mapped to a real passage, and the question is counted.
6. A second, cheaper Gemini call checks each cited sentence against its passage. Citations it can't support show "Not clearly supported by this source".

If nothing relevant is found, FolioMind says so at step 4 without calling Gemini. A failed or stopped answer isn't counted.

## Settings

All of these have working defaults.

| Variable                                      | Default                 | Used for                               |
| --------------------------------------------- | ----------------------- | -------------------------------------- |
| `GEMINI_CHAT_MODEL`                           | `gemini-3.6-flash`      | Answers                                |
| `GEMINI_FAST_MODEL`                           | `gemini-3.5-flash-lite` | Follow-up rewrites and citation checks |
| `JINA_EMBEDDING_MODEL`, `JINA_RERANKER_MODEL` | See `.env.example`      | Must match the index for embeddings    |

Google applies rate limits per model and per project, so the fast model keeps rewrites and checks from using up the quota for answers.

Search settings such as passage counts and the abstention threshold live in `packages/ai/src/retrieval/config.ts`.

## Gemini's free tier

The free tier allows **20 requests a day for each model, across the whole Google project** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, measured 2026-11-05), plus a per-minute limit. Quotas reset at midnight Pacific time, and AI Studio shows your project's current limits.

So that one busy day doesn't stop answers, FolioMind answers on `GEMINI_CHAT_MODEL` first and on `GEMINI_FAST_MODEL` once that model's quota is spent. When both are out, readers see "FolioMind has used today's free AI answers" with **Try again**, and the question isn't counted. For a brief per-minute limit they see "FolioMind's AI is busy right now" instead.

Turning on billing for the Google project lifts these limits. Local testing and the deployed site share them if they use the same project, so a long `pnpm eval:retrieval` run can use up the day's answers on the live site. Give local development its own project to avoid that.

## Deploying a schema change

Migration `0002_chat_citation_support` adds two columns the chat reads and writes. Apply it to Neon **before** deploying this code, following [Neon (staging and production)](database.md#neon-staging-and-production). It only adds columns, so the site that's already running keeps working.

## Measuring retrieval

```sh
pnpm eval:retrieval --retrieval-only   # Jina only: quick, uses no Gemini quota
pnpm eval:retrieval                    # The whole set, at a pace the free tier allows
pnpm eval:retrieval --kind adversarial # One kind of question
pnpm eval:retrieval --delay 13         # Seconds between Gemini answers
pnpm eval:retrieval --threshold 0.15   # Try another abstention threshold
pnpm eval:retrieval --json out.json    # Keep every per-question result
```

`GEMINI_CHAT_MODEL` chooses the model under test, with no fallback, so results belong to that model. A whole run is more answers than one free model allows in a day: it stops cleanly at the limit and reports what it finished.

It builds its own local database (`foliomind_eval_test`) with the production chunker and real embeddings, and it refuses to run against any database that isn't on your machine. The documents and questions are in `packages/ai/src/eval/`. They describe invented places and figures, so a correct answer can only come from retrieval.

Run it before and after changing a retrieval setting, and compare the embedding-only, fusion and reranked rows.
