import type { CitationView, MessageView } from "@foliomind/contracts";

/** "p. 12" or "pp. 12–13". */
export function pageRangeLabel(start: number, end: number): string {
  return start === end ? `p. ${start}` : `pp. ${start}–${end}`;
}

/**
 * An answer as a Reader note: plain text, with its labels swapped for the pages
 * they cite. Reader notes are plain text of up to 5,000 characters (Section 28).
 */
export function answerAsReaderNote(message: Pick<MessageView, "body" | "citations">): string {
  const pages = new Map(
    message.citations.map((citation) => [
      citation.label,
      pageRangeLabel(citation.pageStart, citation.pageEnd),
    ]),
  );
  const text = message.body
    .replace(/\[(S\d+)\]/g, (_, label: string) => {
      const page = pages.get(label);
      return page ? `(${page})` : "";
    })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length > 5000 ? `${text.slice(0, 4999)}…` : text;
}

/** The first page an answer cites: where a saved Reader note belongs. */
export function firstCitedPage(citations: readonly CitationView[]): number | null {
  return citations[0]?.pageStart ?? null;
}

/** Turns [S1] into links the renderer swaps for citation buttons. */
export const linkCitations = (body: string): string =>
  body.replace(/\[(S\d+)\]/g, "[$1](#cite-$1)");

export function allowanceResetLabel(resetsAt: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(resetsAt));
}
