import { projectDocSchema, type ProjectDoc } from "@foliomind/contracts";
import { describe, expect, it } from "vitest";
import {
  AI_GENERATED_LABEL,
  projectBodyHtml,
  projectDocumentHtml,
  projectHeaderFooter,
} from "./project-html";

const VERSION_A = "11111111-1111-4111-8111-111111111111";
const VERSION_B = "22222222-2222-4222-8222-222222222222";
const SECTION = "33333333-3333-4333-8333-333333333333";

const citation = (label: string, versionId: string, pageStart: number, pageEnd = pageStart) => ({
  type: "citation" as const,
  attrs: { label, chunkId: null, versionId, pageStart, pageEnd, draftHash: null },
});

const DOC: ProjectDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2, sectionId: SECTION },
      content: [{ type: "text", text: "Heat & cities" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Trees cool streets", marks: [{ type: "bold" }] },
        { type: "text", text: " by 2 degrees" },
        citation("9", VERSION_A, 3),
        { type: "text", text: " on " },
        { type: "text", text: "average", marks: [{ type: "italic" }] },
        citation("4", VERSION_B, 7, 8),
        citation("9", VERSION_A, 3),
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "City" }] }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Drop" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Lisbon" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }],
            },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Shade" }] }],
        },
      ],
    },
  ],
};

const SOURCES = [
  { versionId: VERSION_A, title: "Harbor <Plan>" },
  { versionId: VERSION_B, title: "Heat Study" },
];

const base = {
  title: "Cities & heat",
  mode: "research" as const,
  template: "academic-report" as const,
  pageSize: "A4" as const,
  cover: false,
  contents: false,
  date: new Date("2026-11-07T00:00:00Z"),
  doc: DOC,
  sources: SOURCES,
};

describe("projectBodyHtml", () => {
  it("renders every allowed node with the same extensions as the editor", () => {
    const html = projectBodyHtml(DOC);
    expect(html).toContain("<h2>Heat &amp; cities</h2>");
    expect(html).toContain("<strong>Trees cool streets</strong>");
    expect(html).toContain("<em>average</em>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th");
    expect(html).toContain("<ul><li><p>Shade</p></li></ul>");
  });

  it("escapes markup typed as text, so it stays text", () => {
    const html = projectBodyHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: '<script>alert(1)</script><img src="http://evil.test/x">' },
          ],
        },
      ],
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps no data attributes or section IDs in the output", () => {
    const html = projectBodyHtml(DOC);
    expect(html).not.toContain("data-");
    expect(html).not.toContain(VERSION_A);
    expect(html).toContain('<span class="fm-cite">[9]</span>');
  });
});

describe("projectDocumentHtml", () => {
  it("numbers citations by first appearance and lists one reference per source and pages", () => {
    const html = projectDocumentHtml(base);
    expect(html).toContain('<span class="fm-cite">[1]</span>');
    expect(html).toContain('<span class="fm-cite">[2]</span>');
    expect(html).not.toContain("[9]");
    expect(html).toContain('<li value="1">Harbor &lt;Plan&gt;, p. 3.</li>');
    expect(html).toContain('<li value="2">Heat Study, pp. 7–8.</li>');
    expect(html.match(/<li value=/g)).toHaveLength(2);
  });

  it("labels general writing as AI generated, and never shows a citation", () => {
    const html = projectDocumentHtml({ ...base, mode: "general" });
    expect(html).toContain(AI_GENERATED_LABEL);
    expect(html).not.toContain('fm-cite">');
    expect(html).not.toContain("References");
    expect(projectHeaderFooter({ ...base, mode: "general" }).footerTemplate).toContain(
      AI_GENERATED_LABEL,
    );
  });

  it("doesn't carry the AI label in research mode", () => {
    expect(projectDocumentHtml(base)).not.toContain(AI_GENERATED_LABEL);
  });

  it("adds the optional cover and contents", () => {
    const html = projectDocumentHtml({
      ...base,
      cover: true,
      contents: true,
      audience: "First-year students",
    });
    expect(html).toContain('class="cover page-break"');
    expect(html).toContain("For First-year students");
    expect(html).toContain("November 7, 2026");
    expect(html).toContain("<li>Heat &amp; cities</li>");
    expect(html).not.toContain('class="title-block"');
  });

  it("loads nothing: no scripts, no links, and fonts only as data URIs", () => {
    for (const template of ["academic-report", "study-notes"] as const) {
      const html = projectDocumentHtml({ ...base, template, cover: true, contents: true });
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<a ");
      expect(html.match(/url\("(?!data:)/g)).toBeNull();
      expect(html.match(/https?:\/\//g)).toBeNull();
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain('font-family: "Source Serif 4"');
    }
  });

  it("escapes the title everywhere it appears", () => {
    const title = '</title><script>alert("x")</script>';
    const html = projectDocumentHtml({ ...base, title });
    expect(html).not.toContain("<script");
    const { headerTemplate } = projectHeaderFooter({ ...base, title });
    expect(headerTemplate).not.toContain("<script");
  });

  it("uses each template's own page setup", () => {
    expect(projectDocumentHtml({ ...base, pageSize: "Letter" })).toContain("size: Letter");
    expect(projectDocumentHtml({ ...base, template: "study-notes" })).toContain("18mm 18mm 20mm");
  });
});

describe("the allowed tree", () => {
  it("accepts what the editor produces", () => {
    expect(projectDocSchema.safeParse(DOC).success).toBe(true);
  });
});
