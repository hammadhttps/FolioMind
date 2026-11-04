import { describe, expect, it } from "vitest";
import { escapeHtml, markdownToSafeHtml, sanitizeArticleHtml } from "./sanitize";
import { webSnapshotHeaderFooter, webSnapshotHtml } from "./templates/web-snapshot";

describe("markdownToSafeHtml (Section 27 step 5)", () => {
  it("keeps the article's structure", () => {
    const html = markdownToSafeHtml(
      [
        "# Title",
        "A paragraph with **bold** and [a link](https://example.com/a).",
        "- one\n- two",
        "> quoted",
        "| a | b |\n|---|---|\n| 1 | 2 |",
        "```\ncode\n```",
      ].join("\n\n"),
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('<a href="https://example.com/a">a link</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre><code>");
  });

  it("removes scripts, styles, frames, forms, images and event handlers", () => {
    const html = markdownToSafeHtml(
      [
        "Text <script>alert(1)</script> more",
        "<style>body{display:none}</style>",
        '<iframe src="https://evil.example"></iframe>',
        '<form action="https://evil.example"><input name="x"></form>',
        "![image](https://example.com/tracker.png)",
        '<img src="x" onerror="alert(1)">',
        '<p onclick="alert(1)" style="color:red">styled</p>',
        "<svg><script>alert(1)</script></svg>",
      ].join("\n\n"),
    );
    const forbidden = [
      "<script",
      "alert(1)",
      "<style",
      "<iframe",
      "<form",
      "<input",
      "<img",
      "onerror",
      "onclick",
      "style=",
      "<svg",
      "tracker.png",
    ];
    for (const fragment of forbidden) expect(html).not.toContain(fragment);
    expect(html).toContain("styled");
  });

  it("allows only http and https links", () => {
    const html = sanitizeArticleHtml(
      [
        '<a href="javascript:alert(1)">x</a>',
        '<a href="data:text/html,hi">y</a>',
        '<a href="//evil.example">z</a>',
        '<a href="mailto:a@b.c">m</a>',
        '<a href="https://ok.example" target="_blank" rel="opener">ok</a>',
      ].join(""),
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html).not.toContain("//evil.example");
    expect(html).not.toContain("mailto:");
    expect(html).toContain('<a href="https://ok.example">ok</a>');
  });
});

describe("Web Snapshot template", () => {
  it("escapes the title and source address and embeds its fonts", () => {
    const html = webSnapshotHtml({
      title: 'Rivers <script>alert("x")</script> & Banks',
      sourceUrl: 'https://example.com/a?b=1&c="2"',
      retrievedAt: new Date("2026-11-04T10:00:00Z"),
      bodyHtml: "<p>Body</p>",
    });
    expect(html).toContain("Rivers &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Banks");
    expect(html).toContain("https://example.com/a?b=1&amp;c=&quot;2&quot;");
    expect(html).toContain("Imported from the web for personal study");
    expect(html).toContain("November 4, 2026");
    // Nothing is fetched while rendering: every resource is inline.
    expect(html).not.toMatch(/src="https?:|url\(["']?https?:/);
    expect(html).toContain("data:font/woff2;base64,");
  });

  it("escapes the header title", () => {
    expect(webSnapshotHeaderFooter("<b>x</b>").headerTemplate).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });
});
