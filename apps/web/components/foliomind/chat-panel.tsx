import { MessageSquareText, Quote, SendHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Cited source chip, e.g. "Sustainable Cities · p. 12" (opens the reader page later). */
export function SourceChip({ label, page }: { label: string; page?: number }) {
  return (
    <Badge variant="research" className="max-w-full">
      <Quote aria-hidden="true" data-icon="inline-start" />
      <span className="truncate">{label}</span>
      {page !== undefined ? <span className="tabular-nums">· p. {page}</span> : null}
    </Badge>
  );
}

/**
 * Chat panel layout (Section 19): message list, composer and suggested-prompt
 * buttons. Phase 3 renders the layout only; Phase 7 streams cited answers.
 */
export function ChatPanel({
  title = "Ask about this",
  description,
  suggestedPrompts = [],
  messages,
  unavailableReason,
  className,
}: {
  title?: string;
  description?: ReactNode;
  suggestedPrompts?: string[];
  /** Rendered conversation; when absent the empty prompt state shows. */
  messages?: ReactNode;
  /** Disables the composer and explains why (e.g. ingestion is incomplete). */
  unavailableReason?: string;
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4" aria-live="polite">
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
                        variant="outline"
                        disabled={unavailable}
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
      </ScrollArea>

      <form className="border-t p-3" aria-label="Ask a question" action={undefined}>
        <label htmlFor="chat-composer" className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            id="chat-composer"
            rows={2}
            disabled={unavailable}
            placeholder={unavailable ? "Questions aren't available yet." : "Ask a question…"}
            className="min-h-11 resize-none bg-background"
          />
          <Button type="button" size="icon" disabled={unavailable} aria-label="Send question">
            <SendHorizontal aria-hidden="true" />
          </Button>
        </div>
      </form>
    </section>
  );
}
