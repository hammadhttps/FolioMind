import { randomUUID } from "node:crypto";
import {
  assets,
  documentChunks,
  documents,
  documentVersions,
  messageCitations,
} from "@foliomind/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { purgeDeletedDocuments } from "../cleanup";
import { deleteDocument } from "../documents";
import { createBook, createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import {
  createConversation,
  deleteThread,
  listMessages,
  listThreads,
  openSource,
  recentHistory,
  renameThread,
  saveExchange,
  threadTitle,
} from ".";

describe("threadTitle", () => {
  it("uses a short question as it is, on one line", () => {
    expect(threadTitle("  What did\nthe plan  cost? ")).toBe("What did the plan cost?");
  });

  it("cuts a long question at a word", () => {
    const title = threadTitle(`${"word ".repeat(40)}end`);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("word…")).toBe(true);
  });
});

describeWithDatabase("conversations", () => {
  let db: ReturnType<typeof testDb>;

  beforeAll(() => {
    db = testDb();
  });

  async function reader() {
    const user = await createUser(db);
    const doc = await createDocument(db, user.id);
    return { user, actor: { id: user.id, status: "active" as const }, doc };
  }

  /** A second version of the document, replacing the first, as a re-import does. */
  async function replaceVersion(documentId: string, ownerId: string) {
    const [asset] = await db
      .insert(assets)
      .values({
        ownerId,
        fileKey: `test-${randomUUID()}`,
        customId: `test-${randomUUID()}`,
        fileRoute: "sourcePdf",
        acl: "private",
        purpose: "source",
        bytes: 1000,
        mimeType: "application/pdf",
        state: "ready",
      })
      .returning();
    const [version] = await db
      .insert(documentVersions)
      .values({
        documentId,
        versionNo: 2,
        assetId: asset!.id,
        sha256: "second",
        status: "ready",
        indexVersion: "test",
        embeddingModel: "test",
        embeddingDimension: 1024,
      })
      .returning();
    await db
      .update(documents)
      .set({ currentVersionId: version!.id })
      .where(eq(documents.id, documentId));
    return version!;
  }

  const question = (body: string, at: Date) => ({ body, focus: null, at });
  const answer = (body: string, at: Date) => ({
    body,
    status: "complete" as const,
    aiRunId: null,
    citations: [],
    at,
  });

  it("saves a question and answer in order, however close their clocks are", async () => {
    const { actor, doc } = await reader();
    const conversation = await createConversation(db, {
      userId: actor.id,
      title: "Thread",
      scope: { kind: "document", versionId: doc.version.id },
    });
    const at = new Date();
    await saveExchange(db, actor, {
      conversationId: conversation.id,
      question: question("First?", at),
      answer: answer("First answer.", at),
    });
    const page = await listMessages(db, actor, conversation.id);
    expect(page?.messages.map((message) => message.body)).toEqual(["First?", "First answer."]);
    expect(await recentHistory(db, conversation.id, 1)).toEqual([
      { role: "assistant", body: "First answer." },
    ]);
  });

  it("walks a long thread backwards with a keyset, oldest first within each page", async () => {
    const { actor, doc } = await reader();
    const conversation = await createConversation(db, {
      userId: actor.id,
      title: "Thread",
      scope: { kind: "document", versionId: doc.version.id },
    });
    const start = Date.now() - 60_000;
    for (let index = 0; index < 5; index += 1) {
      const at = new Date(start + index * 1000);
      await saveExchange(db, actor, {
        conversationId: conversation.id,
        question: question(`Q${index}`, at),
        answer: answer(`A${index}`, new Date(at.getTime() + 100)),
      });
    }
    const newest = await listMessages(db, actor, conversation.id, { limit: 4 });
    expect(newest?.messages.map((message) => message.body)).toEqual(["Q3", "A3", "Q4", "A4"]);

    const older = await listMessages(db, actor, conversation.id, {
      limit: 4,
      cursor: newest!.nextCursor!,
    });
    expect(older?.messages.map((message) => message.body)).toEqual(["Q1", "A1", "Q2", "A2"]);

    const oldest = await listMessages(db, actor, conversation.id, {
      limit: 4,
      cursor: older!.nextCursor!,
    });
    expect(oldest?.messages.map((message) => message.body)).toEqual(["Q0", "A0"]);
    expect(oldest?.nextCursor).toBeNull();

    // A tampered cursor reads as the first page, never as an error.
    const tampered = await listMessages(db, actor, conversation.id, { limit: 4, cursor: "%%%" });
    expect(tampered?.messages[0]?.body).toBe("Q3");
  });

  it("lists one thread list per document, across versions, marking earlier ones", async () => {
    const { user, actor, doc } = await reader();
    const old = await createConversation(db, {
      userId: user.id,
      title: "On the first version",
      scope: { kind: "document", versionId: doc.version.id },
    });
    const replacement = await replaceVersion(doc.document.id, user.id);
    const current = await createConversation(db, {
      userId: user.id,
      title: "On the second version",
      scope: { kind: "document", versionId: replacement.id },
    });
    const threads = await listThreads(db, actor.id, { documentId: doc.document.id });
    expect(threads.map((thread) => [thread.id, thread.current]).sort()).toEqual(
      [
        [old.id, false],
        [current.id, true],
      ].sort(),
    );
    // Another document's list and another user's list are both empty of these.
    const other = await reader();
    expect(await listThreads(db, other.actor.id, { documentId: doc.document.id })).toEqual([]);
    expect(await listThreads(db, actor.id, { documentId: other.doc.document.id })).toEqual([]);
  });

  it("lets only the owner read, rename or delete a thread", async () => {
    const { user, actor, doc } = await reader();
    const conversation = await createConversation(db, {
      userId: user.id,
      title: "Mine",
      scope: { kind: "document", versionId: doc.version.id },
    });
    const stranger = await reader();
    expect(await listMessages(db, stranger.actor, conversation.id)).toBeNull();
    expect(await renameThread(db, stranger.user.id, conversation.id, "Stolen")).toBe(false);
    expect(await deleteThread(db, stranger.user.id, conversation.id)).toBe(false);

    expect(await renameThread(db, user.id, conversation.id, "Renamed")).toBe(true);
    expect((await listThreads(db, actor.id, { documentId: doc.document.id }))[0]?.title).toBe(
      "Renamed",
    );
    expect(await deleteThread(db, user.id, conversation.id)).toBe(true);
    expect(await listMessages(db, actor, conversation.id)).toBeNull();
  });

  describe("opening a citation", () => {
    it("clamps to the document's pages", async () => {
      const { actor, doc } = await reader();
      await db
        .update(documentVersions)
        .set({ pageCount: 5 })
        .where(eq(documentVersions.id, doc.version.id));
      expect(await openSource(db, actor, doc.version.id, 3)).toMatchObject({ page: 3 });
      expect(await openSource(db, actor, doc.version.id, 99)).toMatchObject({ page: 5 });
    });

    it("reports an earlier version instead of showing the newer pages", async () => {
      const { user, actor, doc } = await reader();
      await replaceVersion(doc.document.id, user.id);
      expect(await openSource(db, actor, doc.version.id, 2)).toEqual({
        available: false,
        reason: "superseded",
        documentId: doc.document.id,
      });
    });

    it("opens a published book for any signed-in reader, until it's unpublished", async () => {
      const publisher = await reader();
      await createBook(db, publisher.doc.version.id, { published: true });
      const someone = (await reader()).actor;
      expect(await openSource(db, someone, publisher.doc.version.id, 1)).toMatchObject({
        available: true,
        documentId: publisher.doc.document.id,
      });
    });
  });

  it("purging a source keeps the citation's page and title, not its text", async () => {
    const { actor, doc } = await reader();
    const conversation = await createConversation(db, {
      userId: actor.id,
      title: "Thread",
      scope: { kind: "document", versionId: doc.version.id },
    });
    const [chunk] = await db
      .insert(documentChunks)
      .values({
        documentVersionId: doc.version.id,
        chunkIndex: 0,
        pageStart: 4,
        pageEnd: 4,
        text: "Private words from the document.",
        tokenCount: 6,
        contentHash: randomUUID(),
      })
      .returning();
    const at = new Date();
    const { answer: saved } = await saveExchange(db, actor, {
      conversationId: conversation.id,
      question: question("Question?", at),
      answer: {
        ...answer("A fact [S1].", at),
        citations: [
          {
            label: "S1",
            chunkId: chunk!.id,
            versionId: doc.version.id,
            pageStart: 4,
            pageEnd: 4,
          },
        ],
      },
    });
    expect(saved.citations[0]?.snippet).toBe("Private words from the document.");

    await deleteDocument(db, actor, doc.document.id);
    await purgeDeletedDocuments(db);

    const [row] = await db
      .select()
      .from(messageCitations)
      .where(eq(messageCitations.messageId, saved.id));
    expect(row).toMatchObject({ chunkId: null, sourceAvailable: false, pageStart: 4 });

    const page = await listMessages(db, actor, conversation.id);
    expect(page?.messages[1]?.citations[0]).toMatchObject({
      available: false,
      snippet: null,
      pageStart: 4,
      title: "Test document",
    });
  });
});
