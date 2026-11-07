import { describe, expect, it } from "vitest";
import {
  collectCitations,
  createProjectSchema,
  docReferences,
  docSectionIds,
  outlineSchema,
  projectDocSchema,
  projectDocText,
  readOutline,
  readProjectDoc,
  readProjectSettings,
  renumberCitations,
  sectionNodes,
  stampDraftedCitations,
  studioSettingsFormSchema,
  templateFromVersion,
  projectTemplateVersion,
  upsertDocSection,
  type ProjectBlock,
  type ProjectDoc,
} from "./projects";

const VERSION = "11111111-1111-4111-8111-111111111111";
const OTHER_VERSION = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333331";
const S2 = "33333333-3333-4333-8333-333333333332";
const S3 = "33333333-3333-4333-8333-333333333333";

const citation = (versionId: string, page: number, label = "x") => ({
  type: "citation" as const,
  attrs: { label, chunkId: null, versionId, pageStart: page, pageEnd: page, draftHash: null },
});

const heading = (sectionId: string, text = "Heading"): ProjectBlock => ({
  type: "heading",
  attrs: { level: 2, sectionId },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): ProjectBlock => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("the allowed document tree", () => {
  const accepts = (content: unknown[]) =>
    projectDocSchema.safeParse({ type: "doc", content }).success;

  it("accepts each allowed node", () => {
    expect(
      accepts([
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", content: [{ type: "text", text: "B", marks: [{ type: "bold" }] }] },
        { type: "paragraph" },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
        {
          type: "orderedList",
          attrs: { start: 2 },
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: "paragraph" }],
                },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
        { type: "paragraph", content: [citation(VERSION, 3)] },
      ]),
    ).toBe(true);
  });

  it.each([
    ["a script node", { type: "script", content: [{ type: "text", text: "alert(1)" }] }],
    ["an image", { type: "image", attrs: { src: "https://evil.test/x.png" } }],
    ["raw HTML", { type: "html", html: "<script>alert(1)</script>" }],
    ["a blockquote", { type: "blockquote", content: [{ type: "paragraph" }] }],
    ["a code block", { type: "codeBlock", content: [{ type: "text", text: "x" }] }],
    ["a level 4 heading", { type: "heading", attrs: { level: 4 } }],
  ])("refuses %s", (_name, node) => {
    expect(accepts([node])).toBe(false);
  });

  it("refuses marks and inline nodes outside the list", () => {
    const withMark = (type: string) => ({
      type: "paragraph",
      content: [{ type: "text", text: "x", marks: [{ type }] }],
    });
    expect(accepts([withMark("italic")])).toBe(true);
    expect(accepts([withMark("link")])).toBe(false);
    expect(accepts([withMark("textStyle")])).toBe(false);
    expect(accepts([{ type: "paragraph", content: [{ type: "hardBreak" }] }])).toBe(false);
  });

  it("refuses a citation with no real version or page", () => {
    const attrs = citation(VERSION, 3).attrs;
    const cited = (changes: object) => ({
      type: "paragraph",
      content: [{ type: "citation", attrs: { ...attrs, ...changes } }],
    });
    expect(accepts([cited({})])).toBe(true);
    expect(accepts([cited({ versionId: "not-a-uuid" })])).toBe(false);
    expect(accepts([cited({ pageStart: 0 })])).toBe(false);
  });

  it("drops attributes it doesn't know, so handlers can't be stored", () => {
    const parsed = projectDocSchema.parse({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, onclick: "steal()", sectionId: S1 },
          content: [{ type: "text", text: "A" }],
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("onclick");
    expect(parsed.content[0]).toMatchObject({ attrs: { level: 2, sectionId: S1 } });
  });

  it("keeps markup in text as text", () => {
    const parsed = projectDocSchema.parse({
      type: "doc",
      content: [paragraph("<script>alert(1)</script>")],
    });
    expect(projectDocText(parsed)).toBe("<script>alert(1)</script>");
  });

  it("bounds depth and length", () => {
    let nested: unknown = { type: "paragraph" };
    for (let depth = 0; depth < 20; depth += 1) {
      nested = { type: "bulletList", content: [{ type: "listItem", content: [nested] }] };
    }
    expect(accepts([nested])).toBe(false);
    expect(accepts([paragraph("x".repeat(200_001))])).toBe(false);
    expect(accepts([paragraph("x".repeat(200_000))])).toBe(true);
  });

  it("reads anything malformed as an empty document", () => {
    expect(readProjectDoc({})).toEqual({ type: "doc", content: [] });
    expect(readProjectDoc({ type: "doc", content: [{ type: "script" }] })).toEqual({
      type: "doc",
      content: [],
    });
  });
});

describe("sections inside a document", () => {
  const doc: ProjectDoc = {
    type: "doc",
    content: [paragraph("Before"), heading(S1), paragraph("One"), heading(S3), paragraph("Three")],
  };

  it("finds a section's nodes up to the next section", () => {
    expect(docSectionIds(doc)).toEqual([S1, S3]);
    expect(sectionNodes(doc, S1)).toHaveLength(2);
    expect(sectionNodes(doc, S2)).toBeNull();
  });

  it("a subheading without an ID stays inside its section", () => {
    const withSub: ProjectDoc = {
      type: "doc",
      content: [
        heading(S1),
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Sub" }] },
        paragraph("One"),
      ],
    };
    expect(sectionNodes(withSub, S1)).toHaveLength(3);
  });

  it("replaces a section in place and keeps everything else", () => {
    const next = upsertDocSection(doc, { sectionId: S1, nodes: [heading(S1), paragraph("New")] }, [
      S1,
      S3,
    ]);
    expect(projectDocText(next)).toBe("Before Heading New Heading Three");
  });

  it("inserts a new section in outline order, so a draft fills in order", () => {
    const next = upsertDocSection(doc, { sectionId: S2, nodes: [heading(S2), paragraph("Two")] }, [
      S1,
      S2,
      S3,
    ]);
    expect(docSectionIds(next)).toEqual([S1, S2, S3]);
    const last = upsertDocSection(doc, { sectionId: S2, nodes: [heading(S2)] }, [S1, S3, S2]);
    expect(docSectionIds(last)).toEqual([S1, S3, S2]);
  });
});

describe("citations", () => {
  it("numbers by first appearance and reuses a number for the same source and pages", () => {
    const doc = renumberCitations({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [citation(VERSION, 3), citation(OTHER_VERSION, 3), citation(VERSION, 3)],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [citation(VERSION, 9)] }],
            },
          ],
        },
      ],
    });
    expect(collectCitations(doc).map((item) => item.label)).toEqual(["1", "2", "1", "3"]);
    expect(docReferences(doc).map((item) => item.label)).toEqual(["1", "2", "3"]);
  });

  it("verifies a citation only while its sentence is as drafted", () => {
    const stamped = stampDraftedCitations({
      type: "paragraph",
      content: [
        { type: "text", text: "Trees cool streets" },
        citation(VERSION, 3),
        { type: "text", text: "." },
      ],
    });
    const drafted: ProjectDoc = { type: "doc", content: [stamped] };
    expect(collectCitations(drafted)[0]?.verified).toBe(true);
    expect(docReferences(drafted)[0]?.verified).toBe(true);

    // Spacing alone doesn't count as an edit.
    const respaced = structuredClone(drafted);
    (respaced.content[0] as { content: { text?: string }[] }).content[0]!.text =
      "Trees  cool streets";
    expect(collectCitations(respaced)[0]?.verified).toBe(true);

    const edited = structuredClone(drafted);
    (edited.content[0] as { content: { text?: string }[] }).content[0]!.text = "Trees warm streets";
    const [citationAfter] = collectCitations(edited);
    expect(citationAfter?.verified).toBe(false);
    expect(citationAfter?.pageStart).toBe(3);
    expect(docReferences(edited)[0]?.verified).toBe(false);
  });

  it("stamps citations in lists and tables, and never counts an unstamped one as verified", () => {
    const list = stampDraftedCitations({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "A" }, citation(VERSION, 3)] },
          ],
        },
      ],
    });
    const table = stampDraftedCitations({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "B" }, citation(VERSION, 4)] },
              ],
            },
          ],
        },
      ],
    });
    expect(
      collectCitations({ type: "doc", content: [list, table] }).map((c) => c.verified),
    ).toEqual([true, true]);
    const typedByHand: ProjectDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [citation(VERSION, 3)] }],
    };
    expect(collectCitations(typedByHand)[0]?.verified).toBe(false);
  });
});

describe("forms", () => {
  it("needs a title, and 1–5 sources in research mode only", () => {
    const base = { title: "Report", mode: "research" as const };
    expect(createProjectSchema.safeParse({ ...base, versionIds: [VERSION] }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...base, versionIds: [] }).success).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...base, versionIds: Array(6).fill(VERSION) }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...base, mode: "general", versionIds: [] }).success,
    ).toBe(true);
    expect(
      createProjectSchema.safeParse({ title: "x".repeat(121), mode: "general", versionIds: [] })
        .success,
    ).toBe(false);
  });

  it("applies the Studio limits", () => {
    const values = {
      prompt: "A long enough prompt.",
      audience: "",
      length: "short" as const,
      template: "study-notes" as const,
      pageSize: "Letter" as const,
      cover: true,
      contents: false,
      mode: "general" as const,
    };
    expect(studioSettingsFormSchema.safeParse(values).success).toBe(true);
    expect(studioSettingsFormSchema.safeParse({ ...values, prompt: "Too short" }).success).toBe(
      false,
    );
    expect(
      studioSettingsFormSchema.safeParse({ ...values, prompt: "x".repeat(4001) }).success,
    ).toBe(false);
    expect(
      studioSettingsFormSchema.safeParse({ ...values, audience: "x".repeat(121) }).success,
    ).toBe(false);
  });

  it("holds an outline to 3–15 sections with unique IDs and the field limits", () => {
    const section = (id: string, heading = "Heading", notes = "") => ({ id, heading, notes });
    const ids = Array.from(
      { length: 16 },
      (_, index) => `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    );
    const many = ids.map((id) => section(id));
    expect(outlineSchema.safeParse(many.slice(0, 3)).success).toBe(true);
    expect(outlineSchema.safeParse(many.slice(0, 15)).success).toBe(true);
    expect(outlineSchema.safeParse(many.slice(0, 2)).success).toBe(false);
    expect(outlineSchema.safeParse(many).success).toBe(false);
    expect(
      outlineSchema.safeParse([section(ids[0]!), section(ids[0]!), section(ids[1]!)]).success,
    ).toBe(false);
    expect(
      outlineSchema.safeParse([section(ids[0]!, ""), section(ids[1]!), section(ids[2]!)]).success,
    ).toBe(false);
    expect(
      outlineSchema.safeParse([
        section(ids[0]!, "x".repeat(151)),
        section(ids[1]!),
        section(ids[2]!),
      ]).success,
    ).toBe(false);
    expect(
      outlineSchema.safeParse([
        section(ids[0]!, "H", "x".repeat(501)),
        section(ids[1]!),
        section(ids[2]!),
      ]).success,
    ).toBe(false);
  });

  it("reads stored values safely", () => {
    expect(readOutline("nonsense")).toEqual([]);
    expect(readProjectSettings(null)).toEqual({
      audience: "",
      length: "medium",
      pageSize: "A4",
      cover: false,
      contents: false,
    });
    expect(readProjectSettings({ length: "huge", cover: true })).toMatchObject({
      length: "medium",
      cover: true,
    });
  });

  it("records the template version on an export, and reads it back", () => {
    expect(projectTemplateVersion("study-notes")).toBe("study-notes@1");
    expect(templateFromVersion("study-notes@1")).toBe("study-notes");
    expect(templateFromVersion("unknown@9")).toBe("academic-report");
  });
});
