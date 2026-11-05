import { randomUUID } from "node:crypto";
import type { CitationView } from "@foliomind/contracts";
import { describe, expect, it } from "vitest";
import { answerAsReaderNote, linkCitations, pageRangeLabel } from "./format";
import { parseFrame, readChatEvents } from "./stream";

const citation = (label: string, pageStart: number, pageEnd = pageStart): CitationView => ({
  id: randomUUID(),
  label,
  versionId: randomUUID(),
  documentId: randomUUID(),
  title: "Source",
  pageStart,
  pageEnd,
  available: true,
  support: "unchecked",
  snippet: null,
});

function streamOf(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of readChatEvents(body)) events.push(event);
  return events;
}

describe("readChatEvents", () => {
  it("reads whole events however the network splits them", async () => {
    const events = await collect(
      streamOf(
        'event: delta\ndata: {"type":"del',
        'ta","text":"Hello "}\n\nevent: delta\n',
        'data: {"type":"delta","text":"there"}\n\n',
      ),
    );
    expect(events).toEqual([
      { type: "delta", text: "Hello " },
      { type: "delta", text: "there" },
    ]);
  });

  it("keeps multi-byte characters split across chunks intact", async () => {
    const bytes = new TextEncoder().encode('data: {"type":"delta","text":"café"}\n\n');
    const middle = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, middle));
        controller.enqueue(bytes.slice(middle));
        controller.close();
      },
    });
    expect(await collect(body)).toEqual([{ type: "delta", text: "café" }]);
  });

  it("ignores frames that aren't known events", () => {
    expect(parseFrame('data: {"type":"mystery"}')).toBeNull();
    expect(parseFrame("data: not json")).toBeNull();
    expect(parseFrame(": comment")).toBeNull();
  });
});

describe("answerAsReaderNote", () => {
  it("swaps labels for pages and drops Markdown emphasis", () => {
    const note = answerAsReaderNote({
      body: "The **barrier** cost *a lot* [S1]. It opened later [S2][S9].",
      citations: [citation("S1", 12), citation("S2", 3, 4)],
    });
    expect(note).toBe("The barrier cost a lot (p. 12). It opened later (pp. 3–4).");
  });

  it("fits a Reader note's limit", () => {
    expect(answerAsReaderNote({ body: "x".repeat(6000), citations: [] }).length).toBe(5000);
  });
});

describe("linkCitations", () => {
  it("links markers, including adjacent ones, and nothing else", () => {
    expect(linkCitations("Fact [S1][S2] and [note] [Sample]")).toBe(
      "Fact [S1](#cite-S1)[S2](#cite-S2) and [note] [Sample]",
    );
  });
});

describe("pageRangeLabel", () => {
  it("labels one page or a range", () => {
    expect(pageRangeLabel(5, 5)).toBe("p. 5");
    expect(pageRangeLabel(5, 7)).toBe("pp. 5–7");
  });
});
