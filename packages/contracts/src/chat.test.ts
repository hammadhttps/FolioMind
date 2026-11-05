import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chatEventSchema, chatRequestSchema } from "./chat";
import { noteDocSchema, noteDocText, workspaceFormSchema } from "./workspaces";

describe("chatRequestSchema", () => {
  const base = { clientMessageId: randomUUID(), message: "  What does it say?  " };

  it("needs a conversation or a scope", () => {
    expect(chatRequestSchema.safeParse(base).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, conversationId: randomUUID() }).success).toBe(
      true,
    );
    const parsed = chatRequestSchema.parse({
      ...base,
      scope: { kind: "document", documentId: randomUUID() },
    });
    expect(parsed.message).toBe("What does it say?");
  });

  it("bounds the question, the selection and the source list", () => {
    const scope = { kind: "workspace", workspaceId: randomUUID() };
    expect(chatRequestSchema.safeParse({ ...base, scope, message: "   " }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, scope, message: "x".repeat(2001) }).success).toBe(
      false,
    );
    expect(
      chatRequestSchema.safeParse({
        ...base,
        scope,
        focus: { page: 0, text: "selected" },
      }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({
        ...base,
        scope,
        sourceVersionIds: Array.from({ length: 6 }, () => randomUUID()),
      }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...base, scope, sourceVersionIds: ["not-a-uuid"] }).success,
    ).toBe(false);
  });

  it("rejects an unknown scope kind", () => {
    expect(
      chatRequestSchema.safeParse({ ...base, scope: { kind: "library", id: randomUUID() } })
        .success,
    ).toBe(false);
  });
});

describe("chatEventSchema", () => {
  it("parses the events the stream sends, and refuses others", () => {
    expect(chatEventSchema.safeParse({ type: "delta", text: "Hi" }).success).toBe(true);
    expect(
      chatEventSchema.safeParse({
        type: "error",
        code: "provider_busy",
        message: "Busy",
        retryable: true,
      }).success,
    ).toBe(true);
    expect(
      chatEventSchema.safeParse({
        type: "error",
        code: "stack_trace",
        message: "x",
        retryable: true,
      }).success,
    ).toBe(false);
    expect(chatEventSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });
});

describe("noteDocSchema", () => {
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("accepts the allowed rich text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        paragraph("Body"),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph("Item")] }],
        },
        { type: "blockquote", content: [paragraph("Quote")] },
      ],
    };
    const parsed = noteDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    expect(noteDocText(doc)).toContain("Quote");
  });

  it("refuses links, images, unknown nodes and marks", () => {
    for (const node of [
      { type: "image", attrs: { src: "https://evil.test/x.png" } },
      { type: "codeBlock", content: [] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [{ type: "link", attrs: { href: "https://evil.test" } }],
          },
        ],
      },
    ]) {
      expect(noteDocSchema.safeParse({ type: "doc", content: [node] }).success).toBe(false);
    }
    expect(noteDocSchema.safeParse({ type: "paragraph" }).success).toBe(false);
    expect(noteDocSchema.safeParse(null).success).toBe(false);
  });

  it("strips attributes it doesn't know", () => {
    const parsed = noteDocSchema.parse({
      type: "doc",
      content: [{ type: "paragraph", attrs: { onclick: "alert(1)" }, content: [] }],
    });
    expect(JSON.stringify(parsed)).not.toContain("onclick");
  });

  it("limits length to 20,000 characters and bounds nesting", () => {
    expect(
      noteDocSchema.safeParse({ type: "doc", content: [paragraph("x".repeat(20_000))] }).success,
    ).toBe(true);
    expect(
      noteDocSchema.safeParse({ type: "doc", content: [paragraph("x".repeat(20_001))] }).success,
    ).toBe(false);

    let nested: unknown = paragraph("deep");
    for (let depth = 0; depth < 40; depth += 1) nested = { type: "blockquote", content: [nested] };
    expect(noteDocSchema.safeParse({ type: "doc", content: [nested] }).success).toBe(false);
  });
});

describe("workspaceFormSchema", () => {
  it("applies Section 28's limits", () => {
    expect(workspaceFormSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(workspaceFormSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(
      workspaceFormSchema.safeParse({ name: "ok", description: "x".repeat(281) }).success,
    ).toBe(false);
    expect(workspaceFormSchema.parse({ name: "  Coastal  " }).name).toBe("Coastal");
  });
});
