import {
  chatFocusSchema,
  CONVERSATION_TITLE_MAX_CHARS,
  type ChatFocus,
  type CitationSupport,
  type CitationView,
  type MessageStatus,
  type MessageView,
  type SourceOpenResponse,
  type ThreadView,
} from "@foliomind/contracts";
import {
  conversations,
  documentChunks,
  documents,
  documentVersions,
  messageCitations,
  messages,
  workspaces,
  type Database,
  type Executor,
} from "@foliomind/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { readableSources, type Actor } from "../access";
import { decodeCursor, encodeCursor } from "../library";

/*
 * Conversations (blueprint Sections 8, 11 and 12). A thread belongs to one user
 * and exactly one scope: a document version or a workspace. Citations keep their
 * page and title as tombstones when a source goes, but the source's text comes
 * only from its chunk, which is purged with the document.
 */

export const MESSAGE_PAGE_SIZE = 30;
export const THREAD_LIST_LIMIT = 50;
const SNIPPET_CHARS = 240;

export type ConversationScope =
  { kind: "document"; versionId: string } | { kind: "workspace"; workspaceId: string };

export interface ConversationRow {
  id: string;
  userId: string;
  title: string;
  workspaceId: string | null;
  documentVersionId: string | null;
}

/** A thread title from the first question; the reader can rename it. */
export function threadTitle(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  if (line.length <= CONVERSATION_TITLE_MAX_CHARS) return line;
  const cut = line.slice(0, CONVERSATION_TITLE_MAX_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}

export async function createConversation(
  db: Executor,
  input: { userId: string; scope: ConversationScope; title: string },
): Promise<ConversationRow> {
  const [row] = await db
    .insert(conversations)
    .values({
      userId: input.userId,
      title: input.title,
      workspaceId: input.scope.kind === "workspace" ? input.scope.workspaceId : null,
      documentVersionId: input.scope.kind === "document" ? input.scope.versionId : null,
    })
    .returning();
  if (!row) throw new Error("Conversation insert failed");
  return row;
}

/** The user's own conversation, or null; another user's reads as absent. */
export async function getConversation(
  db: Executor,
  userId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  return row ?? null;
}

/** Removes a thread that a failed first question left empty. */
export async function deleteEmptyConversation(db: Executor, conversationId: string): Promise<void> {
  await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        sql`not exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id})`,
      ),
    );
}

export async function renameThread(
  db: Executor,
  userId: string,
  conversationId: string,
  title: string,
): Promise<boolean> {
  const rows = await db
    .update(conversations)
    .set({ title })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function deleteThread(
  db: Executor,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

/** One list per document, across its versions, or one per workspace; newest first. */
export async function listThreads(
  db: Executor,
  userId: string,
  filter: { documentId: string } | { workspaceId: string },
): Promise<ThreadView[]> {
  if ("workspaceId" in filter) {
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(
        and(eq(conversations.userId, userId), eq(conversations.workspaceId, filter.workspaceId)),
      )
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(THREAD_LIST_LIMIT);
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), current: true }));
  }
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      current: sql<boolean>`${documents.currentVersionId} = ${conversations.documentVersionId}`,
    })
    .from(conversations)
    .innerJoin(documentVersions, eq(documentVersions.id, conversations.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(eq(conversations.userId, userId), eq(documents.id, filter.documentId)))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(THREAD_LIST_LIMIT);
  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    current: row.current === true,
  }));
}

/** The last messages, oldest first, for the follow-up rewrite (bounded by the caller). */
export async function recentHistory(
  db: Executor,
  conversationId: string,
  limit: number,
): Promise<{ role: "user" | "assistant"; body: string }[]> {
  const rows = await db
    .select({ role: messages.role, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

const snippetOf = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= SNIPPET_CHARS) return line;
  const cut = line.slice(0, SNIPPET_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > 120 ? cut.slice(0, space) : cut}…`;
};

const REMOVED_TITLE = "Source no longer available";

/** Citations for these messages, with access checked now, not when they were written. */
async function citationsFor(
  db: Executor,
  actor: Actor,
  messageIds: readonly string[],
): Promise<Map<string, CitationView[]>> {
  const byMessage = new Map<string, CitationView[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({
      id: messageCitations.id,
      messageId: messageCitations.messageId,
      label: messageCitations.citationLabel,
      versionId: messageCitations.sourceVersionId,
      pageStart: messageCitations.pageStart,
      pageEnd: messageCitations.pageEnd,
      support: messageCitations.supportStatus,
      sourceAvailable: messageCitations.sourceAvailable,
      chunkText: documentChunks.text,
      documentId: documentVersions.documentId,
      documentTitle: documents.title,
      ownerId: documents.ownerId,
    })
    .from(messageCitations)
    .leftJoin(documentChunks, eq(documentChunks.id, messageCitations.chunkId))
    .leftJoin(documentVersions, eq(documentVersions.id, messageCitations.sourceVersionId))
    .leftJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(inArray(messageCitations.messageId, [...messageIds]))
    .orderBy(asc(messageCitations.createdAt), asc(messageCitations.citationLabel));

  const versionIds = [...new Set(rows.flatMap((row) => (row.versionId ? [row.versionId] : [])))];
  const readable = new Map(
    (await readableSources(db, actor, versionIds)).map((source) => [source.versionId, source]),
  );
  for (const row of rows) {
    const source = row.versionId ? readable.get(row.versionId) : undefined;
    const available = row.sourceAvailable && source !== undefined;
    const view: CitationView = {
      id: row.id,
      label: row.label,
      versionId: row.versionId,
      documentId: available ? (row.documentId ?? null) : null,
      // The owner keeps their own document's title as a tombstone (Section 12).
      title:
        source?.title ??
        (row.ownerId === actor.id ? (row.documentTitle ?? null) : null) ??
        REMOVED_TITLE,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      available,
      support: row.support as CitationSupport,
      snippet: available && row.chunkText ? snippetOf(row.chunkText) : null,
    };
    const list = byMessage.get(row.messageId);
    if (list) list.push(view);
    else byMessage.set(row.messageId, [view]);
  }
  return byMessage;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  body: string;
  status: string;
  focus: unknown;
  createdAt: Date;
}

const toMessageView = (row: MessageRow, citations: CitationView[]): MessageView => ({
  id: row.id,
  role: row.role,
  body: row.body,
  status: row.status as MessageStatus,
  createdAt: row.createdAt.toISOString(),
  focus: chatFocusSchema
    .nullable()
    .catch(null)
    .parse(row.focus ?? null),
  citations,
});

const messageColumns = {
  id: messages.id,
  role: messages.role,
  body: messages.body,
  status: messages.status,
  focus: messages.focus,
  createdAt: messages.createdAt,
};

/**
 * A page of a thread, oldest first, walking backwards with a keyset cursor
 * (Section 24). Returns null when the thread isn't the actor's.
 */
export async function listMessages(
  db: Executor,
  actor: Actor,
  conversationId: string,
  { cursor, limit = MESSAGE_PAGE_SIZE }: { cursor?: string | undefined; limit?: number } = {},
): Promise<{ messages: MessageView[]; nextCursor: string | null } | null> {
  if (!(await getConversation(db, actor.id, conversationId))) return null;
  const position = decodeCursor(cursor);
  const rows = await db
    .select(messageColumns)
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        position
          ? sql`(${messages.createdAt}, ${messages.id}) < (${position.v}::timestamptz, ${position.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  const citations = await citationsFor(
    db,
    actor,
    page.map((row) => row.id),
  );
  return {
    messages: page.reverse().map((row) => toMessageView(row, citations.get(row.id) ?? [])),
    nextCursor:
      rows.length > limit && oldest
        ? encodeCursor({ v: oldest.createdAt.toISOString(), id: oldest.id })
        : null,
  };
}

export interface ExchangeCitation {
  label: string;
  chunkId: string;
  versionId: string;
  pageStart: number;
  pageEnd: number;
}

/**
 * Stores one question and its answer together, in order. Failures store
 * nothing, so a retried question never appears twice.
 */
export async function saveExchange(
  db: Database,
  actor: Actor,
  input: {
    conversationId: string;
    question: { body: string; focus: ChatFocus | null; at: Date };
    answer: {
      body: string;
      status: MessageStatus;
      aiRunId: string | null;
      citations: readonly ExchangeCitation[];
      at: Date;
    };
  },
): Promise<{ question: MessageView; answer: MessageView }> {
  const saved = await db.transaction(async (tx) => {
    const [question] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: "user",
        body: input.question.body,
        status: "complete",
        focus: input.question.focus,
        createdAt: input.question.at,
        updatedAt: input.question.at,
      })
      .returning(messageColumns);
    const [answer] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: "assistant",
        body: input.answer.body,
        status: input.answer.status,
        aiRunId: input.answer.aiRunId,
        // Always after the question, even on a coarse clock.
        createdAt: new Date(Math.max(input.answer.at.getTime(), input.question.at.getTime() + 1)),
        updatedAt: input.answer.at,
      })
      .returning(messageColumns);
    if (!question || !answer) throw new Error("Message insert failed");
    if (input.answer.citations.length > 0) {
      await tx.insert(messageCitations).values(
        input.answer.citations.map((citation) => ({
          messageId: answer.id,
          chunkId: citation.chunkId,
          sourceVersionId: citation.versionId,
          pageStart: citation.pageStart,
          pageEnd: citation.pageEnd,
          citationLabel: citation.label,
        })),
      );
    }
    const [conversation] = await tx
      .update(conversations)
      .set({ updatedAt: input.answer.at })
      .where(eq(conversations.id, input.conversationId))
      .returning({ workspaceId: conversations.workspaceId });
    if (conversation?.workspaceId) {
      await tx
        .update(workspaces)
        .set({ updatedAt: input.answer.at })
        .where(eq(workspaces.id, conversation.workspaceId));
    }
    return { question, answer };
  });
  const citations = await citationsFor(db, actor, [saved.answer.id]);
  return {
    question: toMessageView(saved.question, []),
    answer: toMessageView(saved.answer, citations.get(saved.answer.id) ?? []),
  };
}

/** Records the support check's verdict per citation (Section 8 step 6). */
export async function setCitationSupport(
  db: Database,
  verdicts: readonly { citationId: string; support: CitationSupport }[],
): Promise<void> {
  if (verdicts.length === 0) return;
  await db.transaction(async (tx) => {
    for (const { citationId, support } of verdicts) {
      await tx
        .update(messageCitations)
        .set({ supportStatus: support })
        .where(eq(messageCitations.id, citationId));
    }
  });
}

/**
 * Opening a citation (Section 8 step 8): access is checked again, and an older
 * version is reported rather than silently replaced by the current pages.
 */
export async function openSource(
  db: Executor,
  actor: Actor,
  versionId: string,
  page: number,
): Promise<SourceOpenResponse> {
  const [source] = await readableSources(db, actor, [versionId]);
  if (!source) return { available: false, reason: "removed", documentId: null };
  if (!source.isCurrent) {
    return { available: false, reason: "superseded", documentId: source.documentId };
  }
  return {
    available: true,
    documentId: source.documentId,
    page: source.pageCount ? Math.min(page, source.pageCount) : page,
  };
}
