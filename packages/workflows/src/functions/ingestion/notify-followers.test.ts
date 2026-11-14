import { randomUUID } from "node:crypto";
import { EVENT_NAMES } from "@foliomind/contracts";
import { books, publisherFollows, type Database } from "@foliomind/db";
import {
  createBook,
  createDocument,
  createUser,
  describeWithDatabase,
  testDb,
} from "@foliomind/domain/test/db";
import { InngestTestEngine } from "@inngest/test";
import { eq } from "drizzle-orm";
import { Inngest } from "inngest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createNotifyFollowersFunction, FOLLOWER_BATCH_SIZE } from "./control";
import type { WorkerADeps } from "./shared";

/*
 * notify-followers (Section 6 "Publishing"): an approval tells the publisher's
 * opted-in followers, in bounded batches through send-notification, with one
 * stable event ID per follower so a retried batch notifies nobody twice.
 */

const sent: {
  name: string;
  id?: string;
  data: { userId: string; type: string; subjectId: string };
}[] = [];
const server = setupServer(
  http.post("https://inngest.test/e/:key", async ({ request }) => {
    const events = (await request.json()) as typeof sent;
    sent.push(...events);
    return HttpResponse.json({ ids: events.map(() => randomUUID()), status: 200 });
  }),
);

function engine(db: Database) {
  const inngest = new Inngest({
    id: "followers-test",
    isDev: false,
    eventKey: "test",
    baseUrl: "https://inngest.test",
  });
  const deps = {
    db,
    concurrency: { ingestion: 1, imports: 2, control: 2 },
    outboxCron: "0 * * * *",
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as WorkerADeps;
  return new InngestTestEngine({ function: createNotifyFollowersFunction(inngest, deps) });
}

async function publishedBookWithFollowers(db: Database, followers: number, quiet: number) {
  const owner = await createUser(db);
  const { version } = await createDocument(db, owner.id);
  const { book, revision } = await createBook(db, version.id, { published: true });
  const ids: string[] = [];
  for (let index = 0; index < followers + quiet; index += 1) {
    const user = await createUser(db);
    await db
      .insert(publisherFollows)
      .values({ userId: user.id, publisherId: book.publisherId, notify: index < followers });
    if (index < followers) ids.push(user.id);
  }
  return { book, revision, followerIds: ids };
}

describeWithDatabase("notify-followers", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => {
    server.resetHandlers();
    sent.length = 0;
  });
  afterAll(() => server.close());

  it("sends one notification event per opted-in follower, in batches", async () => {
    const db = testDb();
    const { book, revision, followerIds } = await publishedBookWithFollowers(
      db,
      FOLLOWER_BATCH_SIZE + 5,
      3,
    );
    const operationKey = `book-published:${revision.id}`;
    const { result } = await engine(db).execute({
      events: [
        {
          name: EVENT_NAMES.catalogBookPublished,
          data: {
            bookId: book.id,
            revisionId: revision.id,
            publisherId: book.publisherId,
            operationKey,
          },
        },
      ],
    });
    expect(result).toEqual({ notified: followerIds.length });
    expect(sent.every((event) => event.name === EVENT_NAMES.notificationCreated)).toBe(true);
    expect(sent.map((event) => event.data.userId).sort()).toEqual([...followerIds].sort());
    expect(new Set(sent.map((event) => event.id)).size).toBe(followerIds.length);
    expect(sent[0]).toMatchObject({
      id: `book-published:${revision.id}:${sent[0]!.data.userId}`,
      data: { type: "publisher_new_book", subjectId: revision.id },
    });
  });

  it("tells nobody once the revision is no longer the live one", async () => {
    const db = testDb();
    const { book, revision } = await publishedBookWithFollowers(db, 2, 0);
    await db.update(books).set({ status: "removed" }).where(eq(books.id, book.id));
    const { result } = await engine(db).execute({
      events: [
        {
          name: EVENT_NAMES.catalogBookPublished,
          data: {
            bookId: book.id,
            revisionId: revision.id,
            publisherId: book.publisherId,
            operationKey: `book-published:${revision.id}`,
          },
        },
      ],
    });
    expect(result).toEqual({ notified: 0 });
    expect(sent).toEqual([]);
  });
});
