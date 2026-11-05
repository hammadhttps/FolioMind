import { z } from "zod";

/*
 * Cited chat (blueprint Sections 8 and 11). `POST /api/chat` takes one question
 * for a conversation or a new scope, and answers with a stream of the events
 * below. The scope comes from the request or the stored conversation, checked
 * on the server; nothing in the conversation text can choose a document.
 */

export const CHAT_QUESTION_MAX_CHARS = 2000;
export const CHAT_SELECTION_MAX_CHARS = 2000;
export const CONVERSATION_TITLE_MAX_CHARS = 80;
/** Section 10: Pro's cap; each plan's own cap applies when sources are added. */
export const WORKSPACE_SOURCES_HARD_MAX = 5;

/** "Ask about selection": the selected text is the question's focus; its page stays on the message. */
export const chatFocusSchema = z.object({
  page: z.number().int().min(1),
  text: z.string().trim().min(1).max(CHAT_SELECTION_MAX_CHARS),
});
export type ChatFocus = z.infer<typeof chatFocusSchema>;

export const chatScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), documentId: z.uuid() }),
  z.object({ kind: z.literal("workspace"), workspaceId: z.uuid() }),
]);
export type ChatScopeInput = z.infer<typeof chatScopeSchema>;

export const chatRequestSchema = z
  .object({
    /** One per question, so a repeated request never charges twice. */
    clientMessageId: z.uuid(),
    message: z
      .string()
      .trim()
      .min(1, "Write a question first.")
      .max(CHAT_QUESTION_MAX_CHARS, "Use 2,000 characters or fewer."),
    conversationId: z.uuid().optional(),
    scope: chatScopeSchema.optional(),
    /** The workspace sources ticked in the rail; always intersected with what is allowed. */
    sourceVersionIds: z.array(z.uuid()).min(1).max(WORKSPACE_SOURCES_HARD_MAX).optional(),
    focus: chatFocusSchema.optional(),
  })
  .refine((value) => value.conversationId || value.scope, {
    message: "A conversation or a scope is required.",
    path: ["scope"],
  });
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const CITATION_SUPPORT = ["unchecked", "supported", "unsupported"] as const;
export type CitationSupport = (typeof CITATION_SUPPORT)[number];

export const citationViewSchema = z.object({
  id: z.uuid(),
  /** "S1", as written in the answer. */
  label: z.string(),
  versionId: z.uuid().nullable(),
  documentId: z.uuid().nullable(),
  title: z.string(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  /** False once the source was deleted or access to it ended. */
  available: z.boolean(),
  support: z.enum(CITATION_SUPPORT),
  /** A short passage from the chunk; gone with the source's text. */
  snippet: z.string().nullable(),
});
export type CitationView = z.infer<typeof citationViewSchema>;

export const MESSAGE_STATUSES = ["complete", "abstained", "stopped"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const messageViewSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  body: z.string(),
  status: z.enum(MESSAGE_STATUSES),
  createdAt: z.string(),
  focus: chatFocusSchema.nullable(),
  citations: z.array(citationViewSchema),
});
export type MessageView = z.infer<typeof messageViewSchema>;

export const questionAllowanceSchema = z.object({
  planCode: z.enum(["free", "pro"]),
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  /** The other plan's monthly allowance, for the upgrade explanation. */
  proLimit: z.number().int().nonnegative(),
  resetsAt: z.string(),
});
export type QuestionAllowance = z.infer<typeof questionAllowanceSchema>;

export const threadViewSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.string(),
  /** False for a Reader thread on an earlier version of the document. */
  current: z.boolean(),
});
export type ThreadView = z.infer<typeof threadViewSchema>;

/** Why the answer stopped, in words a reader can act on (Section 20). */
export const CHAT_ERRORS = {
  unauthenticated: "Sign in to ask questions.",
  account_inactive: "Your account can't ask questions right now.",
  invalid: "Check your question and try again.",
  not_found: "This conversation isn't available anymore.",
  no_sources: "None of the selected sources are ready for questions.",
  quota_exceeded: "You've used all your AI questions for this month.",
  duplicate: "That question was already sent.",
  provider_busy:
    "FolioMind's AI is busy right now. Your question wasn't counted. Please try again in a minute.",
  provider_daily_limit:
    "FolioMind has used today's free AI answers. Your question wasn't counted. Please try again tomorrow.",
  failed: "We couldn't finish that answer. Your question wasn't counted. Please try again.",
} as const;
export type ChatErrorCode = keyof typeof CHAT_ERRORS;

export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    conversationId: z.uuid(),
    title: z.string(),
    created: z.boolean(),
  }),
  z.object({ type: z.literal("status"), phase: z.enum(["searching", "answering"]) }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    question: messageViewSchema,
    answer: messageViewSchema,
    allowance: questionAllowanceSchema,
  }),
  z.object({
    type: z.literal("verified"),
    messageId: z.uuid(),
    citations: z.array(z.object({ id: z.uuid(), support: z.enum(CITATION_SUPPORT) })),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(Object.keys(CHAT_ERRORS) as [ChatErrorCode, ...ChatErrorCode[]]),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const threadRenameSchema = z.object({
  conversationId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(CONVERSATION_TITLE_MAX_CHARS, "Use 80 characters or fewer."),
});

/** What opening a citation found; a newer version is never shown in its place (Section 8 step 8). */
export const sourceOpenResponseSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), documentId: z.uuid(), page: z.number().int().min(1) }),
  z.object({
    available: z.literal(false),
    reason: z.enum(["removed", "superseded"]),
    /** Set when the document can still be read, in a newer version. */
    documentId: z.uuid().nullable(),
  }),
]);
export type SourceOpenResponse = z.infer<typeof sourceOpenResponseSchema>;
