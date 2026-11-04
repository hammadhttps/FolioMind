import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/*
 * Section 27 step 5: Markdown from Jina Reader becomes HTML with `marked`, then
 * passes an allowlist of headings, paragraphs, lists, blockquotes, code,
 * tables and http/https links. Scripts, styles, iframes, forms and images are
 * removed, so user content can never become renderer instructions.
 */

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "a",
  "em",
  "strong",
  "b",
  "i",
  "s",
  "del",
  "sup",
  "sub",
  "dl",
  "dt",
  "dd",
];

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    // Removed with their content, not unwrapped.
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "noscript",
      "iframe",
      "form",
      "svg",
      "math",
    ],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        const kept: Record<string, string> = {};
        if (attribs.href) kept.href = attribs.href;
        return { tagName, attribs: kept };
      },
    },
  });
}

/** Markdown → sanitized HTML (no raw HTML from the page survives the allowlist). */
export function markdownToSafeHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return sanitizeArticleHtml(html);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
