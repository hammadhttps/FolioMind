import { Ban, MessageSquareText, Quote, SendHorizontal, Square, TriangleAlert } from "lucide-react";
import {
  useId,
  type FormEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Cited source chip, e.g. "S1 Sustainable Cities · p. 12". It opens the cited
 * page; a source that's gone shows as unavailable and only explains why.
 */
export function SourceChip({
  label,
  page,
  title,
  unavailable = false,
  unsupported = false,
  onOpen,
}: {
  label: string;
  page?: number;
  /** Accessible and visible source name; `label` alone suits a short chip. */
  title?: string;
  unavailable?: boolean;
  unsupported?: boolean;
  onOpen?: () => void;
}) {
  const Icon = unavailable ? Ban : unsupported ? TriangleAlert : Quote;
  const content = (
    <>
      <Icon aria-hidden="true" data-icon="inline-start" />
      <span className="font-semibold">{title ? label : null}</span>
      <span className="truncate">{title ?? label}</span>
      {page !== undefined ? <span className="tabular-nums">· p. {page}</span> : null}
    </>
  );
  const variant = unavailable ? "secondary" : unsupported ? "warning" : "research";
  if (!onOpen) {
    return (
      <Badge variant={variant} className="max-w-full">
        {content}
      </Badge>
    );
  }
  const status = unavailable
    ? ", source no longer available"
    : unsupported
      ? ", not clearly supported by this source"
      : "";
  return (
    <Badge variant={variant} asChild className="h-7 max-w-full cursor-pointer hover:opacity-85">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open source ${label}: ${title ?? ""}${page !== undefined ? `, page ${page}` : ""}${status}`}
      >
        {content}
      </button>
    </Badge>
  );
}

/** The question box: Enter sends, Shift+Enter starts a new line. */
export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  busy = false,
  onStop,
  placeholder = "Ask a question…",
  above,
  below,
  maxLength,
  textareaRef,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  /** An answer is arriving: the button becomes Stop. */
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
  above?: ReactNode;
  below?: ReactNode;
  maxLength?: number;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  const submit: FormEventHandler = (event) => {
    event.preventDefault();
    if (!busy && !disabled) onSubmit?.();
  };
  const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy && !disabled) onSubmit?.();
    }
  };
  return (
    <form className="space-y-2 border-t p-3" aria-label="Ask a question" onSubmit={submit}>
      {above}
      <label htmlFor={id} className="sr-only">
        Your question
      </label>
      <div className="flex items-end gap-2">
        <Textarea
          id={id}
          ref={textareaRef}
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          className="max-h-40 min-h-11 resize-none bg-background"
          {...(onValueChange
            ? {
                value: value ?? "",
                onChange: (event) => onValueChange(event.target.value),
                onKeyDown,
              }
            : {})}
        />
        {/*
          Separate elements, kept apart by their keys. Stopping can put the question back and
          swap these buttons while the browser is still finishing the click, and reusing one
          element would then submit the form: Stop would send the question again.
        */}
        {busy ? (
          <Button
            key="stop"
            type="button"
            size="icon"
            variant="outline"
            aria-label="Stop generating"
            onClick={(event) => {
              event.preventDefault();
              onStop?.();
            }}
          >
            <Square aria-hidden="true" className="fill-current" />
          </Button>
        ) : (
          <Button
            key="send"
            type="submit"
            size="icon"
            disabled={disabled}
            aria-label="Send question"
          >
            <SendHorizontal aria-hidden="true" />
          </Button>
        )}
      </div>
      {below}
    </form>
  );
}

/**
 * Chat panel layout (Section 19): message list, composer and suggested-prompt
 * buttons. `ChatConversation` gives it its behaviour; alone it renders states.
 */
export function ChatPanel({
  title = "Ask about this",
  description,
  toolbar,
  suggestedPrompts = [],
  onPrompt,
  messages,
  unavailableReason,
  composer,
  scrollRef,
  onScroll,
  busy = false,
  className,
}: {
  title?: string;
  description?: ReactNode;
  /** Thread controls, under the header. */
  toolbar?: ReactNode;
  suggestedPrompts?: string[];
  onPrompt?: (prompt: string) => void;
  /** Rendered conversation; when absent the empty prompt state shows. */
  messages?: ReactNode;
  /** Disables the composer and explains why (e.g. ingestion is incomplete). */
  unavailableReason?: string | null | undefined;
  composer?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: () => void;
  busy?: boolean;
  className?: string;
}) {
  const unavailable = Boolean(unavailableReason);
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-[420px] flex-col overflow-hidden rounded-xl border bg-card shadow-card",
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b px-4 py-3.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
          <MessageSquareText className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[0.9375rem] font-semibold">{title}</h2>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </header>
      {toolbar}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-label="Conversation"
        aria-busy={busy}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/70 focus-visible:ring-inset"
      >
        <div className="space-y-4 p-4">
          {messages ?? (
            <div className="space-y-3">
              {unavailableReason ? (
                <p className="rounded-lg bg-muted px-3.5 py-3 text-sm text-muted-foreground">
                  {unavailableReason}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Good questions lead to good ideas.</p>
              )}
              {suggestedPrompts.length > 0 ? (
                <ul className="grid gap-2" aria-label="Suggested questions">
                  {suggestedPrompts.map((prompt) => (
                    <li key={prompt}>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={unavailable}
                        onClick={onPrompt ? () => onPrompt(prompt) : undefined}
                        className="h-auto min-h-10 w-full justify-start py-2 text-left whitespace-normal"
                      >
                        {prompt}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {composer ?? (
        <ChatComposer
          disabled={unavailable}
          placeholder={unavailable ? "Questions aren't available yet." : "Ask a question…"}
        />
      )}
    </section>
  );
}
