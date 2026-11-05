import { randomUUID } from "node:crypto";
import { answerToNoteDoc, type NoteDoc } from "@foliomind/contracts";
import {
  conversations,
  documents,
  libraryItems,
  messageCitations,
  messages,
  projects,
  projectSources,
  workspaceNotes,
} from "@foliomind/db";
import { eq, sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { deleteDocument } from "../documents";
import { createBook, createDocument, createUser, describeWithDatabase, testDb } from "../test/db";
import {
  addWorkspaceSource,
  createProjectFromWorkspace,
  createWorkspace,
  createWorkspaceNote,
  deleteWorkspace,
  deleteWorkspaceNote,
  getWorkspaceDetail,
  listSourceCandidates,
  listWorkspaces,
  listWorkspaceSources,
  removeWorkspaceSource,
  saveAnswerToNotes,
  updateWorkspace,
  updateWorkspaceNote,
} from ".";

describeWithDatabase("research workspaces", () => {
  let db: ReturnType<typeof testDb>;

  beforeAll(() => {
    db = testDb();
  });

  async function setup() {
    const user = await createUser(db);
    const actor = { id: user.id, status: "active" as const };
    const workspace = await createWorkspace(db, actor, { name: "Coastal research" });
    return { user, actor, workspaceId: workspace!.id };
  }

  it("creates, renames, lists and deletes only for the owner", async () => {
    const { actor, workspaceId } = await setup();
    const stranger = { id: (await createUser(db)).id, status: "active" as const };

    expect(await updateWorkspace(db, stranger, workspaceId, { name: "Stolen" })).toBe(false);
    expect(await deleteWorkspace(db, stranger, workspaceId)).toBe(false);
    expect(await getWorkspaceDetail(db, stranger, workspaceId)).toBeNull();

    expect(
      await updateWorkspace(db, actor, workspaceId, { name: "Renamed", description: "Notes" }),
    ).toBe(true);
    const detail = await getWorkspaceDetail(db, actor, workspaceId);
    expect(detail).toMatchObject({
      name: "Renamed",
      description: "Notes",
      sourceLimit: 2,
      planCode: "free",
    });
    const listed = await listWorkspaces(db, { userId: stranger.id, sort: "updated", limit: 12 });
    expect(listed.items).toEqual([]);

    expect(await deleteWorkspace(db, actor, workspaceId)).toBe(true);
    expect(await getWorkspaceDetail(db, actor, workspaceId)).toBeNull();
  });

  it("deleting a workspace keeps its documents", async () => {
    const { user, actor, workspaceId } = await setup();
    const doc = await createDocument(db, user.id);
    await addWorkspaceSource(db, actor, { workspaceId, versionId: doc.version.id });
    await deleteWorkspace(db, actor, workspaceId);
    const [kept] = await db
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, doc.document.id));
    expect(kept?.status).toBe("active");
  });

  it("searches and pages with a keyset, in both sort orders", async () => {
    const user = await createUser(db);
    const actor = { id: user.id, status: "active" as const };
    for (const name of ["Delta", "alpha", "Charlie", "bravo", "100%_done"]) {
      await createWorkspace(db, actor, { name });
    }
    const first = await listWorkspaces(db, { userId: user.id, sort: "name", limit: 2 });
    expect(first.items.map((item) => item.name)).toEqual(["100%_done", "alpha"]);
    const second = await listWorkspaces(db, {
      userId: user.id,
      sort: "name",
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.name)).toEqual(["bravo", "Charlie"]);
    const third = await listWorkspaces(db, {
      userId: user.id,
      sort: "name",
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(third.items.map((item) => item.name)).toEqual(["Delta"]);
    expect(third.nextCursor).toBeNull();

    const recent = await listWorkspaces(db, { userId: user.id, sort: "updated", limit: 3 });
    expect(recent.items[0]?.name).toBe("100%_done");
    const older = await listWorkspaces(db, {
      userId: user.id,
      sort: "updated",
      limit: 3,
      cursor: recent.nextCursor!,
    });
    expect(older.items).toHaveLength(2);
    expect(new Set([...recent.items, ...older.items].map((item) => item.name)).size).toBe(5);

    // Wildcards in a search are literal.
    const search = await listWorkspaces(db, {
      userId: user.id,
      sort: "name",
      limit: 12,
      q: "%_",
    });
    expect(search.items.map((item) => item.name)).toEqual(["100%_done"]);
  });

  it("enforces the plan's source cap on the server, even in parallel", async () => {
    const { user, actor, workspaceId } = await setup();
    const docs = await Promise.all(Array.from({ length: 4 }, () => createDocument(db, user.id)));
    const results = await Promise.all(
      docs.map((doc) => addWorkspaceSource(db, actor, { workspaceId, versionId: doc.version.id })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)[0]).toMatchObject({
      code: "source_limit",
      limit: 2,
      planCode: "free",
    });
    expect(await listWorkspaceSources(db, actor, workspaceId)).toHaveLength(2);
  });

  it("refuses sources the user can't read or that aren't ready, and duplicates", async () => {
    const { user, actor, workspaceId } = await setup();
    const foreign = await createDocument(db, (await createUser(db)).id);
    expect(
      await addWorkspaceSource(db, actor, { workspaceId, versionId: foreign.version.id }),
    ).toEqual({ ok: false, code: "not_found" });

    const processing = await createDocument(db, user.id);
    await db.execute(
      sql`update document_versions set status = 'queued' where id = ${processing.version.id}`,
    );
    expect(
      await addWorkspaceSource(db, actor, { workspaceId, versionId: processing.version.id }),
    ).toEqual({ ok: false, code: "not_ready" });

    const ready = await createDocument(db, user.id);
    expect(
      await addWorkspaceSource(db, actor, { workspaceId, versionId: ready.version.id }),
    ).toEqual({ ok: true });
    expect(
      await addWorkspaceSource(db, actor, { workspaceId, versionId: ready.version.id }),
    ).toEqual({ ok: false, code: "already_added" });

    // Someone else's workspace can't take sources.
    const stranger = { id: (await createUser(db)).id, status: "active" as const };
    expect(
      await addWorkspaceSource(db, stranger, { workspaceId, versionId: ready.version.id }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      await removeWorkspaceSource(db, stranger, { workspaceId, versionId: ready.version.id }),
    ).toBe(false);
  });

  it("shows a revoked source as unavailable and adding is not access", async () => {
    const { user, actor, workspaceId } = await setup();
    const doc = await createDocument(db, user.id);
    await addWorkspaceSource(db, actor, { workspaceId, versionId: doc.version.id });
    expect((await listWorkspaceSources(db, actor, workspaceId))[0]).toMatchObject({
      available: true,
      documentId: doc.document.id,
    });
    await deleteDocument(db, actor, doc.document.id);
    expect((await listWorkspaceSources(db, actor, workspaceId))[0]).toMatchObject({
      available: false,
      documentId: null,
      title: "Test document",
    });
    // Removing it still works.
    expect(await removeWorkspaceSource(db, actor, { workspaceId, versionId: doc.version.id })).toBe(
      true,
    );
    expect(await listWorkspaceSources(db, actor, workspaceId)).toEqual([]);
  });

  it("offers only ready, readable documents not already added", async () => {
    const { user, actor, workspaceId } = await setup();
    const addLibraryItem = async (documentId: string) =>
      db.insert(libraryItems).values({ userId: user.id, documentId });
    const ready = await createDocument(db, user.id);
    const added = await createDocument(db, user.id);
    const processing = await createDocument(db, user.id);
    await db.execute(
      sql`update document_versions set status = 'embedding' where id = ${processing.version.id}`,
    );
    const deleted = await createDocument(db, user.id);
    for (const doc of [ready, added, processing, deleted]) await addLibraryItem(doc.document.id);
    await deleteDocument(db, actor, deleted.document.id);
    await addWorkspaceSource(db, actor, { workspaceId, versionId: added.version.id });

    // Another user's document, even one saved by mistake, never appears.
    const foreign = await createDocument(db, (await createUser(db)).id);
    await addLibraryItem(foreign.document.id);

    // A published book saved to the library does; an unpublished one doesn't.
    const published = await createDocument(db, (await createUser(db)).id);
    const { book } = await createBook(db, published.version.id, { published: true });
    await db.insert(libraryItems).values({ userId: user.id, bookId: book.id });
    const hidden = await createDocument(db, (await createUser(db)).id);
    const { book: draft } = await createBook(db, hidden.version.id, { published: false });
    await db.insert(libraryItems).values({ userId: user.id, bookId: draft.id });

    const page = await listSourceCandidates(db, actor, {
      workspaceId,
      type: "all",
      limit: 20,
    });
    expect(page?.items.map((item) => item.versionId).sort()).toEqual(
      [ready.version.id, published.version.id].sort(),
    );
    const saved = await listSourceCandidates(db, actor, { workspaceId, type: "saved", limit: 20 });
    expect(saved?.items.map((item) => item.kind)).toEqual(["saved"]);

    const paged = await listSourceCandidates(db, actor, { workspaceId, type: "all", limit: 1 });
    expect(paged?.items).toHaveLength(1);
    const rest = await listSourceCandidates(db, actor, {
      workspaceId,
      type: "all",
      limit: 1,
      cursor: paged!.nextCursor!,
    });
    expect(rest?.items).toHaveLength(1);
    expect(rest?.items[0]?.versionId).not.toEqual(paged?.items[0]?.versionId);

    const stranger = { id: (await createUser(db)).id, status: "active" as const };
    expect(
      await listSourceCandidates(db, stranger, { workspaceId, type: "all", limit: 20 }),
    ).toBeNull();
  });

  it("creates a project with the selected, usable sources only", async () => {
    const { user, actor, workspaceId } = await setup();
    const kept = await createDocument(db, user.id);
    const revoked = await createDocument(db, user.id);
    const notInWorkspace = await createDocument(db, user.id);
    await addWorkspaceSource(db, actor, { workspaceId, versionId: kept.version.id });
    await addWorkspaceSource(db, actor, { workspaceId, versionId: revoked.version.id });
    await deleteDocument(db, actor, revoked.document.id);

    const result = await createProjectFromWorkspace(db, actor, {
      workspaceId,
      versionIds: [kept.version.id, revoked.version.id, notInWorkspace.version.id],
    });
    expect(result.ok).toBe(true);
    const projectId = result.ok ? result.projectId : "";
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project).toMatchObject({
      ownerId: user.id,
      workspaceId,
      title: "Coastal research",
      mode: "research",
      status: "draft",
      templateKey: "academic-report",
    });
    const sources = await db
      .select({ versionId: projectSources.documentVersionId })
      .from(projectSources)
      .where(eq(projectSources.projectId, projectId));
    expect(sources).toEqual([{ versionId: kept.version.id }]);

    expect(
      await createProjectFromWorkspace(db, actor, {
        workspaceId,
        versionIds: [notInWorkspace.version.id],
      }),
    ).toEqual({ ok: false, code: "no_sources" });
    const stranger = { id: (await createUser(db)).id, status: "active" as const };
    expect(
      await createProjectFromWorkspace(db, stranger, {
        workspaceId,
        versionIds: [kept.version.id],
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });

  it("autosaves notes for their author only", async () => {
    const { actor, workspaceId } = await setup();
    const note = await createWorkspaceNote(db, actor, workspaceId);
    const body: NoteDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Finding" }] }],
    };
    const stranger = { id: (await createUser(db)).id, status: "active" as const };
    expect(await createWorkspaceNote(db, stranger, workspaceId)).toBeNull();
    expect(await updateWorkspaceNote(db, stranger, note!.id, body)).toBeNull();
    expect(await deleteWorkspaceNote(db, stranger, note!.id)).toBe(false);

    expect((await updateWorkspaceNote(db, actor, note!.id, body))?.body).toEqual(body);
    expect(await deleteWorkspaceNote(db, actor, note!.id)).toBe(true);
    expect(await db.select().from(workspaceNotes).where(eq(workspaceNotes.id, note!.id))).toEqual(
      [],
    );
  });

  async function answerWithCitation(
    userId: string,
    workspaceId: string,
    versionId: string,
    body = "The plan cost **412 million** [S1].\n\n- First point [S1]",
  ) {
    const [conversation] = await db
      .insert(conversations)
      .values({ userId, workspaceId, title: "Thread" })
      .returning();
    const [message] = await db
      .insert(messages)
      .values({ conversationId: conversation!.id, role: "assistant", body, status: "complete" })
      .returning();
    await db.insert(messageCitations).values({
      messageId: message!.id,
      sourceVersionId: versionId,
      pageStart: 12,
      pageEnd: 12,
      citationLabel: "S1",
    });
    return { conversationId: conversation!.id, messageId: message!.id };
  }

  it("saves an answer as a note with its message and citations, once", async () => {
    const { user, actor, workspaceId } = await setup();
    const doc = await createDocument(db, user.id);
    await addWorkspaceSource(db, actor, { workspaceId, versionId: doc.version.id });
    const { messageId } = await answerWithCitation(user.id, workspaceId, doc.version.id);

    const note = await saveAnswerToNotes(db, actor, { workspaceId, messageId });
    expect(note?.sourceMessageId).toBe(messageId);
    expect(note?.citations).toEqual([
      {
        label: "S1",
        versionId: doc.version.id,
        title: "Test document",
        pageStart: 12,
        pageEnd: 12,
      },
    ]);
    expect(note?.body.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "The plan cost " },
        { type: "text", text: "412 million", marks: [{ type: "bold" }] },
        { type: "text", text: " [S1]." },
      ],
    });
    expect(note?.body.content[1]?.type).toBe("bulletList");

    const again = await saveAnswerToNotes(db, actor, { workspaceId, messageId });
    expect(again?.id).toBe(note?.id);

    // The note outlives the conversation, and its chips still name the source.
    await db.delete(conversations).where(eq(conversations.workspaceId, workspaceId));
    const detail = await getWorkspaceDetail(db, actor, workspaceId);
    expect(detail?.notes[0]).toMatchObject({ sourceMessageId: null });
    expect(detail?.notes[0]?.citations[0]?.pageStart).toBe(12);
  });

  it("won't save someone else's answer or a question", async () => {
    const { user, actor, workspaceId } = await setup();
    const doc = await createDocument(db, user.id);
    const { messageId, conversationId } = await answerWithCitation(
      user.id,
      workspaceId,
      doc.version.id,
    );
    const stranger = await setup();
    expect(
      await saveAnswerToNotes(db, stranger.actor, {
        workspaceId: stranger.workspaceId,
        messageId,
      }),
    ).toBeNull();
    expect(await saveAnswerToNotes(db, stranger.actor, { workspaceId, messageId })).toBeNull();

    const [question] = await db
      .insert(messages)
      .values({ conversationId, role: "user", body: "Question?", status: "complete" })
      .returning();
    expect(await saveAnswerToNotes(db, actor, { workspaceId, messageId: question!.id })).toBeNull();
    expect(await saveAnswerToNotes(db, actor, { workspaceId, messageId: randomUUID() })).toBeNull();
  });

  it("builds notes only from allowed nodes", () => {
    const doc = answerToNoteDoc(
      "# Title\n\n1. One\n2. Two\n\n[link](https://evil.test) *it* **b**",
    );
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "orderedList", "paragraph"]);
    expect(JSON.stringify(doc)).not.toContain('"link"');
  });
});
