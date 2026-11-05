"use client";

import {
  CHAT_QUESTION_MAX_CHARS,
  threadRenameSchema,
  type ChatFocus,
  type ChatScopeInput,
  type CitationView,
  type MessageView,
  type QuestionAllowance,
  type ThreadView,
} from "@foliomind/contracts";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ChevronsUpDown, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { deleteThreadAction, loadThreadAction, renameThreadAction } from "@/lib/chat/actions";
import { allowanceResetLabel } from "@/lib/chat/format";
import { readChatEvents } from "@/lib/chat/stream";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { ChatComposer, ChatPanel } from "../chat-panel";
import { useIsPreview } from "../session-user";
import { AnswerMessage, ChatFailure, QuestionMessage } from "./chat-message";

type ThreadPage = { messages: MessageView[]; nextCursor: string | null };
type ThreadData = InfiniteData<ThreadPage, string | undefined>;

const threadKey = (id: string | null) => ["chat-thread", id] as const;

interface Pending {
  question: string;
  focus: ChatFocus | null;
  text: string;
  phase: "searching" | "answering" | null;
  stopped: boolean;
}

const PHASE_LABELS = {
  searching: "Searching your sources…",
  answering: "Writing the answer…",
} as const;

export interface ChatConversationProps {
  scope: ChatScopeInput;
  title: string;
  description: ReactNode;
  suggestedPrompts: string[];
  threads: ThreadView[];
  allowance: QuestionAllowance | null;
  unavailableReason?: string | null | undefined;
  /** The workspace's ticked sources, read when a question is sent. */
  sourceVersionIds?: readonly string[] | undefined;
  focus?: ChatFocus | null;
  onClearFocus?: () => void;
  onOpenCitation: (citation: CitationView) => void;
  onSaveToNotes?: (message: MessageView) => void;
  savedMessageIds?: ReadonlySet<string>;
  abstainHelp?: ReactNode;
  className?: string;
}

/**
 * The real chat (Sections 7, 8 and 20): threads, streamed answers with labelled
 * source chips, Stop and Try again, and the allowance. Messages come from the
 * server; only the answer still arriving lives here.
 */
export function ChatConversation({
  scope,
  title,
  description,
  suggestedPrompts,
  threads: initialThreads,
  allowance: initialAllowance,
  unavailableReason,
  sourceVersionIds,
  focus = null,
  onClearFocus,
  onOpenCitation,
  onSaveToNotes,
  savedMessageIds,
  abstainHelp,
  className,
}: ChatConversationProps) {
  const preview = useIsPreview();
  const queryClient = useQueryClient();
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(
    initialThreads.find((thread) => thread.current)?.id ?? null,
  );
  const [allowance, setAllowance] = useState(initialAllowance);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<{
    question: string;
    focus: ChatFocus | null;
    message: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const thread = useInfiniteQuery({
    queryKey: threadKey(threadId),
    enabled: Boolean(threadId) && !preview,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<ThreadPage> => {
      const result = await loadThreadAction({ conversationId: threadId, cursor: pageParam });
      if (!result.ok) throw new Error(result.formError ?? "We couldn't load this conversation.");
      return result.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Saved answers change only through this component, which updates the cache itself.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const messages = thread.data
    ? [...thread.data.pages].reverse().flatMap((page) => page.messages)
    : [];

  const streaming = pending !== null && !pending.stopped;
  const busy = streaming || syncing;
  const atLimit = allowance !== null && allowance.remaining <= 0;
  const disabled = Boolean(unavailableReason) || atLimit || preview;

  // Keep the newest words in view unless the reader has scrolled up to read.
  const contentLength = (pending?.text.length ?? 0) + messages.length;
  useEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [contentLength, pending?.phase, failure]);
  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, []);

  // A selection's question usually starts right away.
  useEffect(() => {
    if (focus) textareaRef.current?.focus();
  }, [focus]);

  const updateThreadPages = useCallback(
    (id: string, update: (pages: ThreadPage[]) => ThreadPage[]) => {
      queryClient.setQueryData<ThreadData>(threadKey(id), (data) =>
        data ? { ...data, pages: update(data.pages) } : data,
      );
    },
    [queryClient],
  );

  async function send(question: string, questionFocus: ChatFocus | null) {
    const text = question.trim();
    if (!text || busy || disabled) return;
    if (sourceVersionIds && sourceVersionIds.length === 0) return;

    const previousThreadId = threadId;
    let conversationId = threadId;
    let createdThread = false;
    let received = "";
    let settled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    followRef.current = true;
    setFailure(null);
    setDraft("");
    onClearFocus?.();
    setPending({
      question: text,
      focus: questionFocus,
      text: "",
      phase: "searching",
      stopped: false,
    });

    const fail = (message: string) => {
      settled = true;
      setPending(null);
      setFailure({ question: text, focus: questionFocus, message });
      if (createdThread) {
        // The server removed the empty thread.
        setThreads((current) => current.filter((item) => item.id !== conversationId));
        setThreadId(previousThreadId);
      }
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(),
          message: text,
          ...(threadId ? { conversationId: threadId } : { scope }),
          ...(sourceVersionIds ? { sourceVersionIds } : {}),
          ...(questionFocus ? { focus: questionFocus } : {}),
        }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          error?: {
            code?: string;
            message?: string;
            retryAfterSeconds?: number;
            allowance?: QuestionAllowance;
          };
        } | null;
        if (response.status === 429) {
          // Nothing was spent: the question goes back in the box to send again.
          settled = true;
          setPending(null);
          setDraft(text);
          showRateLimitToast(body?.error?.retryAfterSeconds);
          return;
        }
        if (body?.error?.allowance) setAllowance(body.error.allowance);
        fail(body?.error?.message ?? "We couldn't send that question. Please try again.");
        return;
      }

      for await (const event of readChatEvents(response.body)) {
        switch (event.type) {
          case "start": {
            conversationId = event.conversationId;
            if (event.created) {
              createdThread = true;
              queryClient.setQueryData<ThreadData>(threadKey(event.conversationId), {
                pages: [{ messages: [], nextCursor: null }],
                pageParams: [undefined],
              });
              setThreads((current) => [
                {
                  id: event.conversationId,
                  title: event.title,
                  updatedAt: new Date().toISOString(),
                  current: true,
                },
                ...current,
              ]);
              setThreadId(event.conversationId);
            }
            break;
          }
          case "status":
            setPending((current) => (current ? { ...current, phase: event.phase } : current));
            break;
          case "delta":
            received += event.text;
            setPending((current) => (current ? { ...current, text: received } : current));
            break;
          case "done": {
            settled = true;
            const id = conversationId;
            if (id) {
              updateThreadPages(id, (pages) => {
                const [newest, ...older] = pages;
                return [
                  {
                    messages: [...(newest?.messages ?? []), event.question, event.answer],
                    nextCursor: newest?.nextCursor ?? null,
                  },
                  ...older,
                ];
              });
            }
            setAllowance(event.allowance);
            setPending(null);
            createdThread = false;
            break;
          }
          case "verified": {
            const id = conversationId;
            if (id) {
              const verdicts = new Map(event.citations.map((item) => [item.id, item.support]));
              updateThreadPages(id, (pages) =>
                pages.map((page) => ({
                  ...page,
                  messages: page.messages.map((message) =>
                    message.id === event.messageId
                      ? {
                          ...message,
                          citations: message.citations.map((citation) => ({
                            ...citation,
                            support: verdicts.get(citation.id) ?? citation.support,
                          })),
                        }
                      : message,
                  ),
                })),
              );
            }
            break;
          }
          case "error":
            fail(event.message);
            break;
        }
      }
      if (!settled) fail("The answer was interrupted. Please try again.");
    } catch {
      if (settled) return;
      if (controller.signal.aborted) {
        if (received.trim() && conversationId) {
          // The server is saving what was shown; swap to that copy once it exists.
          setPending((current) => (current ? { ...current, stopped: true, phase: null } : current));
          setSyncing(true);
          const id = conversationId;
          for (const wait of [600, 1200, 2000]) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            const result = await loadThreadAction({ conversationId: id }).catch(() => null);
            if (result?.ok && result.data.messages.at(-1)?.status === "stopped") {
              queryClient.setQueryData<ThreadData>(threadKey(id), {
                pages: [result.data],
                pageParams: [undefined],
              });
              break;
            }
          }
          setPending(null);
          setSyncing(false);
        } else {
          // Stopped before any words: nothing was saved, so the question goes back.
          setPending(null);
          setDraft(text);
          if (createdThread) {
            setThreads((current) => current.filter((item) => item.id !== conversationId));
            setThreadId(previousThreadId);
          }
        }
        return;
      }
      fail("We lost the connection. Please try again.");
    }
  }

  function startNewThread() {
    setThreadId(null);
    setFailure(null);
    textareaRef.current?.focus();
  }

  async function removeThread() {
    if (!threadId) return;
    const removed = threadId;
    setDialog(null);
    const result = await deleteThreadAction(removed).catch(() => null);
    if (!result?.ok) {
      toast.error(result?.formError ?? "We couldn't delete that conversation.");
      return;
    }
    const rest = threads.filter((item) => item.id !== removed);
    setThreads(rest);
    setThreadId(rest.find((item) => item.current)?.id ?? null);
    queryClient.removeQueries({ queryKey: threadKey(removed) });
  }

  const currentThread = threads.find((item) => item.id === threadId) ?? null;
  const hasContent = messages.length > 0 || pending !== null || failure !== null;
  const loadingThread = Boolean(threadId) && thread.isPending && !preview;

  const toolbar = (
    <div className="flex items-center gap-1 border-b px-2 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || preview}
            className="h-8 min-w-0 flex-1 justify-between font-normal"
            aria-label={`Conversations. Current: ${currentThread?.title ?? "New conversation"}`}
          >
            <span className="truncate">{currentThread?.title ?? "New conversation"}</span>
            <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-72 max-w-[85vw] overflow-y-auto">
          {threads.length === 0 ? (
            <DropdownMenuItem disabled>No conversations yet</DropdownMenuItem>
          ) : (
            <DropdownMenuRadioGroup
              value={threadId ?? ""}
              onValueChange={(value) => {
                setThreadId(value);
                setFailure(null);
              }}
            >
              {threads.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  <span className="truncate">{item.title}</span>
                  {item.current ? null : (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      Earlier version
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy || preview}
        aria-label="New conversation"
        onClick={startNewThread}
      >
        <Plus aria-hidden="true" />
      </Button>
      {currentThread ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="Conversation actions"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  const list = loadingThread ? (
    <div className="space-y-3" aria-label="Loading conversation">
      <Skeleton className="ml-auto h-10 w-2/3 rounded-xl" />
      <Skeleton className="h-24 w-5/6 rounded-xl" />
    </div>
  ) : thread.isError ? (
    <ChatFailure
      message="We couldn't load this conversation."
      onRetry={() => void thread.refetch()}
    />
  ) : hasContent ? (
    <>
      {thread.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={thread.isFetchingNextPage}
            onClick={() => {
              followRef.current = false;
              void thread.fetchNextPage();
            }}
          >
            {thread.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}
            Load earlier messages
          </Button>
        </div>
      ) : null}
      {messages.map((message) =>
        message.role === "user" ? (
          <QuestionMessage key={message.id} body={message.body} focus={message.focus} />
        ) : (
          <AnswerMessage
            key={message.id}
            body={message.body}
            status={message.status}
            citations={message.citations}
            onOpenCitation={onOpenCitation}
            onSave={onSaveToNotes ? () => onSaveToNotes(message) : undefined}
            saved={savedMessageIds?.has(message.id) ?? false}
            abstainHelp={abstainHelp}
          />
        ),
      )}
      {pending ? (
        <>
          <QuestionMessage body={pending.question} focus={pending.focus} />
          <AnswerMessage
            body={pending.text}
            status={pending.stopped ? "stopped" : "complete"}
            citations={[]}
            streaming={streaming}
            phaseLabel={pending.phase && !pending.text ? PHASE_LABELS[pending.phase] : undefined}
          />
        </>
      ) : null}
      {failure ? (
        <>
          <QuestionMessage body={failure.question} focus={failure.focus} />
          <ChatFailure
            message={failure.message}
            {...(atLimit ? {} : { onRetry: () => void send(failure.question, failure.focus) })}
          />
        </>
      ) : null}
    </>
  ) : undefined;

  return (
    <>
      <ChatPanel
        title={title}
        description={description}
        toolbar={preview ? undefined : toolbar}
        suggestedPrompts={suggestedPrompts}
        onPrompt={(prompt) => void send(prompt, null)}
        messages={list}
        unavailableReason={unavailableReason}
        scrollRef={scrollRef}
        onScroll={onScroll}
        busy={streaming}
        className={className}
        composer={
          <ChatComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => void send(draft, focus)}
            disabled={disabled}
            busy={busy}
            onStop={() => abortRef.current?.abort()}
            maxLength={CHAT_QUESTION_MAX_CHARS}
            textareaRef={textareaRef}
            placeholder={
              unavailableReason
                ? "Questions aren't available yet."
                : atLimit
                  ? "You've used this month's questions."
                  : focus
                    ? "Ask about the selected text…"
                    : "Ask a question…"
            }
            above={
              focus ? (
                <div className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
                  <p className="line-clamp-2 min-w-0 flex-1 font-serif text-[0.8125rem]/snug">
                    <span className="font-sans font-medium">Selected on page {focus.page}: </span>
                    {focus.text}
                  </p>
                  <button
                    type="button"
                    aria-label="Remove the selected text"
                    className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/70"
                    onClick={onClearFocus}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </div>
              ) : null
            }
            below={allowance ? <AllowanceLine allowance={allowance} /> : null}
          />
        }
      />
      <p className="sr-only" role="status">
        {streaming
          ? pending?.phase === "searching"
            ? PHASE_LABELS.searching
            : PHASE_LABELS.answering
          : ""}
      </p>
      <RenameThreadDialog
        open={dialog === "rename"}
        title={currentThread?.title ?? ""}
        conversationId={threadId}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        onRenamed={(id, next) =>
          setThreads((current) =>
            current.map((item) => (item.id === id ? { ...item, title: next } : item)),
          )
        }
      />
      <AlertDialog
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Its questions and answers are removed. Your documents and saved notes stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void removeThread()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Discreet until the allowance runs out, then it explains the plans (Sections 10 and 20). */
function AllowanceLine({ allowance }: { allowance: QuestionAllowance }) {
  if (allowance.remaining <= 0) {
    const plan = allowance.planCode === "pro" ? "Pro" : "Free";
    return (
      <p className="rounded-lg bg-warning-bg px-2.5 py-2 text-xs/relaxed text-warning">
        You&apos;ve used all {allowance.limit} questions on the {plan} plan this month. They renew
        on {allowanceResetLabel(allowance.resetsAt)}.
        {allowance.planCode === "pro" ? null : (
          <>
            {" "}
            Pro includes {allowance.proLimit} a month.{" "}
            <Link href="/pricing" className="font-medium underline underline-offset-2">
              Compare plans
            </Link>
          </>
        )}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {allowance.remaining} of {allowance.limit} questions left this month
    </p>
  );
}

function RenameThreadDialog({
  open,
  title,
  conversationId,
  onOpenChange,
  onRenamed,
}: {
  open: boolean;
  title: string;
  conversationId: string | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (id: string, title: string) => void;
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename conversation"
      description="A short name helps you find it later."
    >
      {open && conversationId ? (
        <RenameThreadForm
          key={conversationId}
          initial={title}
          conversationId={conversationId}
          onCancel={() => onOpenChange(false)}
          onRenamed={(next) => {
            onRenamed(conversationId, next);
            onOpenChange(false);
          }}
        />
      ) : null}
    </AppDialog>
  );
}

function RenameThreadForm({
  initial,
  conversationId,
  onCancel,
  onRenamed,
}: {
  initial: string;
  conversationId: string;
  onCancel: () => void;
  onRenamed: (title: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const parsed = threadRenameSchema.safeParse({ conversationId, title: value });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Enter a title.");
          return;
        }
        setSaving(true);
        const result = await renameThreadAction(parsed.data).catch(() => null);
        setSaving(false);
        if (result?.ok) onRenamed(result.data.title);
        else setError(result?.formError ?? "We couldn't rename it. Please try again.");
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="thread-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="thread-title"
          value={value}
          maxLength={80}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "thread-title-error" : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id="thread-title-error" className="text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner aria-hidden="true" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
