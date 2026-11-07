import {
  docReferences,
  PROJECT_TEMPLATE_LABELS,
  renumberCitations,
  type ProjectBlock,
  type ProjectDoc,
  type ProjectMode,
  type ProjectPageSize,
  type ProjectTemplate,
  type RevisionSource,
} from "@foliomind/contracts";
import type { JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/html/server";
import sanitizeHtml from "sanitize-html";
import { projectExtensions } from "./editor";
import { escapeHtml } from "./sanitize";
import { FONT_FACE_CSS } from "./templates/fonts-css";
import { projectStyles } from "./templates/project-styles";

/*
 * A project's document as print HTML (blueprint Sections 8 and 26). HTML comes
 * only from the allowed nodes, through the editor's own extensions, then through
 * an allowlist with no URLs at all. The page carries no scripts and no links, and
 * its fonts are data URIs, so the renderer has nothing to fetch.
 */

/** Section 26: input HTML is capped at 5 MB and output at 200 pages. */
export const MAX_EXPORT_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_EXPORT_PAGES = 200;

/** Shown in the Studio and on every general-mode export (Section 6). */
export const AI_GENERATED_LABEL = "AI generated, not grounded in your sources";

/** Blocks everything except the styles and fonts inside the page itself. */
export const PROJECT_DOCUMENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'";

export interface ProjectDocumentInput {
  title: string;
  mode: ProjectMode;
  template: ProjectTemplate;
  pageSize: ProjectPageSize;
  cover: boolean;
  contents: boolean;
  audience?: string | undefined;
  /** The date printed on a cover. */
  date: Date;
  doc: ProjectDoc;
  /** Titles frozen with the revision, for the References. */
  sources: readonly RevisionSource[];
}

/** General writing never shows source citations, whatever a document holds (Section 6). */
function withoutCitations(doc: ProjectDoc): ProjectDoc {
  const strip = <T>(node: T): T => {
    const value = node as { content?: { type?: string }[] };
    if (!Array.isArray(value.content)) return node;
    return {
      ...node,
      content: value.content.filter((child) => child.type !== "citation").map(strip),
    };
  };
  return strip(doc);
}

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "table",
  "colgroup",
  "col",
  "tbody",
  "thead",
  "tr",
  "th",
  "td",
  "span",
];

/** The document's body: escaped by the serializer, then filtered to the allowlist. */
export function projectBodyHtml(doc: ProjectDoc): string {
  const html = generateHTML(doc as JSONContent, projectExtensions);
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      span: ["class"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedClasses: { span: ["fm-cite"] },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
}

const inlineText = (node: ProjectBlock): string =>
  node.type === "heading"
    ? (node.content ?? []).map((child) => (child.type === "text" ? child.text : "")).join("")
    : "";

const pages = (start: number, end: number) =>
  start === end ? `p. ${start}` : `pp. ${start}–${end}`;

function referencesHtml(doc: ProjectDoc, sources: readonly RevisionSource[]): string {
  const references = docReferences(doc);
  if (references.length === 0) return "";
  const titles = new Map(sources.map((source) => [source.versionId, source.title]));
  const items = references.map((reference) => {
    const title = titles.get(reference.versionId) ?? "Source no longer available";
    return `<li value="${Number(reference.label)}">${escapeHtml(title)}, ${pages(reference.pageStart, reference.pageEnd)}.</li>`;
  });
  return `<section class="references"><h2>References</h2><ol>${items.join("")}</ol></section>`;
}

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(date);

export function projectDocumentHtml(input: ProjectDocumentInput): string {
  const general = input.mode === "general";
  const doc = general ? withoutCitations(input.doc) : renumberCitations(input.doc);
  const title = escapeHtml(input.title);
  const audience = input.audience?.trim();
  const label = general ? `<p class="ai-label">${AI_GENERATED_LABEL}</p>` : "";
  const audienceLine = audience ? `<p class="meta">For ${escapeHtml(audience)}</p>` : "";

  const cover = input.cover
    ? `<section class="cover page-break"><h1>${title}</h1>${audienceLine}<p class="meta">${escapeHtml(formatDate(input.date))}</p>${label}</section>`
    : "";
  const headings = doc.content.filter(
    (node) => node.type === "heading" && node.attrs.level <= 2 && inlineText(node).trim(),
  );
  const contents =
    input.contents && headings.length > 0
      ? `<section class="contents page-break"><h2>Contents</h2><ol>${headings
          .map((node) => `<li>${escapeHtml(inlineText(node))}</li>`)
          .join("")}</ol></section>`
      : "";
  const titleBlock = input.cover
    ? ""
    : `<header class="title-block"><h1>${title}</h1>${audienceLine}${label}</header>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PROJECT_DOCUMENT_CSP}">
<title>${title}</title>
<style>${FONT_FACE_CSS}${projectStyles(input.template, input.pageSize)}</style>
</head>
<body>
${cover}${contents}${titleBlock}
<article>
${projectBodyHtml(doc)}
</article>
${general ? "" : referencesHtml(doc, input.sources)}
</body>
</html>`;
}

/** Puppeteer header and footer (Section 26): the escaped title, and page numbers. */
export function projectHeaderFooter(input: {
  title: string;
  mode: ProjectMode;
  template: ProjectTemplate;
}): { headerTemplate: string; footerTemplate: string } {
  const padding = input.template === "study-notes" ? "18mm" : "24mm";
  const style = `style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #6b7280; width: 100%; padding: 0 ${padding};"`;
  const note =
    input.mode === "general" ? AI_GENERATED_LABEL : PROJECT_TEMPLATE_LABELS[input.template];
  return {
    headerTemplate: `<div ${style}><span style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(input.title.slice(0, 120))}</span></div>`,
    footerTemplate: `<div ${style}><span>${escapeHtml(note)}</span><span style="float:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  };
}
