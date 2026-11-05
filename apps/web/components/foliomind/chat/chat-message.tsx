"use client";

import type { CitationView, MessageView } from "@foliomind/contracts";
import { BookmarkPlus, Check, Info, RefreshCw, TextQuote, TriangleAlert } from "lucide-react";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { linkCitations, pageRangeLabel } from "@/lib/chat/format";
import { cn } from "@/lib/utils";
import { SourceChip } from "../chat-panel";

/** Only citation links keep their address; a model can't add a link or load an image. */
const onlyCitationLinks = (url: string) => (url.startsWith("#cite-") ? url : "");

/**
 * Answer text from Markdown (Section 31: `react-markdown`, `remark-gfm`, no raw
 * HTML). Document text reaches the model, so this renders nothing that can load
 * a resource or leave the page: raw HTML is dropped, images are removed and
 * other links become plain text. `[S1]` becomes a button that opens the source.
 */
function AnswerMarkdown({
  body,
  citations,
  onOpenCitation,
}: {
  body: string;
  citations: readonly CitationView[];
  onOpenCitation: ((citation: CitationView) => void) | undefined;
}) {
  const components = useMemo<Components>(() => {
    const byLabel = new Map(citations.map((citation) => [citation.label, citation]));
    return {
      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
      h1: Strong,
      h2: Strong,
      h3: Strong,
      h4: Strong,
      h5: Strong,
      h6: Strong,
      ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
      ol: ({ children }) => (
        <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
      ),
      blockquote: ({ children }) => (
        <blockquote className="mb-2 border-l-3 border-border pl-3 text-muted-foreground last:mb-0">
          {children}
        </blockquote>
      ),
      code: ({ children }) => (
        <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.8125rem]">
          {children}
        </code>
      ),
      pre: ({ children }) => <pre className="mb-2 overflow-x-auto last:mb-0">{children}</pre>,
      table: ({ children }) => (
        <div className="mb-2 overflow-x-auto last:mb-0">
          <table className="w-full border-collapse text-[0.8125rem]">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
      ),
      td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
      hr: () => null,
      img: () => null,
      a: ({ href, children }) => {
        const label = href?.startsWith("#cite-") ? href.slice(6) : null;
        if (!label) return <>{children}</>;
        return <CitationMark label={label} citation={byLabel.get(label)} onOpen={onOpenCitation} />;
      },
    };
  }, [citations, onOpenCitation]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      skipHtml
      urlTransform={onlyCitationLinks}
    >
      {linkCitations(body)}
    </ReactMarkdown>
  );
}

function Strong({ children }: { children?: ReactNode }) {
  return <p className="mb-1 font-semibold">{children}</p>;
}

function CitationMark({
  label,
  citation,
  onOpen,
}: {
  label: string;
  citation: CitationView | undefined;
  onOpen: ((citation: CitationView) => void) | undefined;
}) {
  const className =
    "mx-0.5 inline-flex h-[1.15rem] items-center rounded bg-research-subtle px-1 align-[0.1em] text-[0.6875rem] font-semibold text-research-subtle-foreground no-underline";
  // Until the answer is complete a marker has no verified source to open.
  if (!citation || !onOpen) {
    return <span className={className}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(citation)}
      aria-label={`Open source ${label}: ${citation.title}, ${pageRangeLabel(citation.pageStart, citation.pageEnd)}`}
      className={cn(
        className,
        "cursor-pointer outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/70",
        citation.support === "unsupported" && "bg-warning-bg text-warning",
        !citation.available && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SourceList({
  citations,
  onOpenCitation,
}: {
  citations: readonly CitationView[];
  onOpenCitation: ((citation: CitationView) => void) | undefined;
}) {
  const unsupported = citations.filter(
    (citation) => citation.available && citation.support === "unsupported",
  );
  const snippets = citations.filter((citation) => citation.snippet);
  return (
    <div className="mt-3 space-y-2 border-t border-border/70 pt-2.5">
      <ul className="flex flex-wrap gap-1.5" aria-label="Sources">
        {citations.map((citation) => (
          <li key={citation.id} className="max-w-full min-w-0">
            <SourceChip
              label={citation.label}
              title={citation.title}
              page={citation.pageStart}
              unavailable={!citation.available}
              unsupported={citation.support === "unsupported"}
              {...(onOpenCitation ? { onOpen: () => onOpenCitation(citation) } : {})}
            />
          </li>
        ))}
      </ul>
      {unsupported.length > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            {unsupported.map((citation) => citation.label).join(", ")}: Not clearly supported by
            this source.
          </span>
        </p>
      ) : null}
      {citations.some((citation) => !citation.available) ? (
        <p className="text-xs text-muted-foreground">
          A source this answer cites is no longer available.
        </p>
      ) : null}
      {snippets.length > 0 ? (
        <details className="group text-xs">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/70">
            <TextQuote aria-hidden="true" className="size-3.5" />
            Show source text
          </summary>
          <ul className="mt-2 space-y-2">
            {snippets.map((citation) => (
              <li key={citation.id} className="rounded-lg bg-background px-2.5 py-2">
                <p className="mb-0.5 font-medium">
                  {citation.label} · {citation.title} ·{" "}
                  {pageRangeLabel(citation.pageStart, citation.pageEnd)}
                </p>
                <p className="font-serif text-[0.8125rem]/relaxed text-muted-foreground">
                  {citation.snippet}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function QuestionMessage({ body, focus }: { body: string; focus: MessageView["focus"] }) {
  return (
    <div className="ml-auto max-w-[88%] space-y-1">
      {focus ? (
        <blockquote className="line-clamp-3 border-l-3 border-primary pl-2 font-serif text-xs/relaxed text-muted-foreground">
          <span className="font-sans font-medium">Page {focus.page}: </span>
          {focus.text}
        </blockquote>
      ) : null}
      <p className="rounded-xl bg-primary-subtle px-3.5 py-2.5 text-sm/relaxed break-words whitespace-pre-wrap text-primary-subtle-foreground">
        {body}
      </p>
    </div>
  );
}

export function AnswerMessage({
  body,
  status,
  citations,
  streaming = false,
  saved = false,
  onOpenCitation,
  onSave,
  abstainHelp,
  phaseLabel,
}: {
  body: string;
  status: MessageView["status"];
  citations: readonly CitationView[];
  streaming?: boolean;
  saved?: boolean;
  onOpenCitation?: ((citation: CitationView) => void) | undefined;
  onSave?: (() => void) | undefined;
  abstainHelp?: ReactNode;
  phaseLabel?: string | undefined;
}) {
  const abstained = status === "abstained";
  return (
    <div
      className={cn(
        "max-w-[95%] rounded-xl bg-muted px-3.5 py-2.5 text-sm/relaxed break-words",
        abstained && "border border-info/25 bg-info-bg",
      )}
    >
      {abstained ? (
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-info">
          <Info aria-hidden="true" className="size-3.5" />
          Not found in your sources
        </p>
      ) : null}
      {body ? (
        <AnswerMarkdown body={body} citations={citations} onOpenCitation={onOpenCitation} />
      ) : (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-3.5 w-52" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      )}
      {streaming && phaseLabel ? (
        <p className="mt-1 text-xs text-muted-foreground">{phaseLabel}</p>
      ) : null}
      {abstained && abstainHelp ? <div className="mt-2 text-xs">{abstainHelp}</div> : null}
      {status === "stopped" ? (
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          Stopped. This question wasn&apos;t counted.
        </p>
      ) : null}
      {status === "complete" && !streaming && citations.length === 0 ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
          This answer doesn&apos;t cite your sources, so check it against the document.
        </p>
      ) : null}
      {citations.length > 0 ? (
        <SourceList citations={citations} onOpenCitation={onOpenCitation} />
      ) : null}
      {onSave && !streaming && status === "complete" ? (
        <div className="mt-2 -ml-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saved}
            onClick={onSave}
            className="h-8"
          >
            {saved ? <Check aria-hidden="true" /> : <BookmarkPlus aria-hidden="true" />}
            {saved ? "Saved to notes" : "Save to notes"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ChatFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: ComponentProps<typeof Button>["onClick"];
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-error/25 bg-error-bg px-3.5 py-2.5 text-sm text-error"
    >
      <span className="min-w-0 flex-1 basis-48">{message}</span>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="h-8 bg-card">
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
