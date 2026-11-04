import {
  interRegular,
  interSemiBold,
  serifItalic,
  serifRegular,
  serifSemiBold,
} from "../fonts.generated";
import { escapeHtml } from "../sanitize";

/*
 * The Web Snapshot print template (blueprint Section 27 step 6): title, source
 * address, retrieval date and the personal-study note, followed by the
 * sanitized article. Fonts are data URIs and the page has no scripts, so the
 * renderer loads nothing from the network.
 */

export interface WebSnapshotInput {
  title: string;
  sourceUrl: string;
  retrievedAt: Date;
  /** Already sanitized with `markdownToSafeHtml`. */
  bodyHtml: string;
}

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(date);

export function webSnapshotHtml(input: WebSnapshotInput): string {
  const title = escapeHtml(input.title);
  const url = escapeHtml(input.sourceUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
@font-face { font-family: "Inter"; font-weight: 400; src: url("${interRegular}") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; src: url("${interSemiBold}") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 400; src: url("${serifRegular}") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 400; font-style: italic; src: url("${serifItalic}") format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 600; src: url("${serifSemiBold}") format("woff2"); }
@page { size: A4; margin: 22mm 20mm 24mm; }
* { box-sizing: border-box; }
html { color: #1f2937; background: #ffffff; }
body { margin: 0; font-family: "Source Serif 4", Georgia, serif; font-size: 11.5pt; line-height: 1.55; }
header.snapshot { font-family: "Inter", Arial, sans-serif; border-bottom: 1px solid #d6d9e4; padding-bottom: 12pt; margin-bottom: 18pt; }
header.snapshot .kicker { font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase; color: #4338ca; font-weight: 600; margin: 0 0 6pt; }
header.snapshot h1 { font-family: "Source Serif 4", Georgia, serif; font-weight: 600; font-size: 22pt; line-height: 1.2; margin: 0 0 8pt; color: #111827; }
header.snapshot dl { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 10pt; margin: 0; font-size: 8.5pt; color: #4b5563; }
header.snapshot dt { font-weight: 600; }
header.snapshot dd { margin: 0; word-break: break-all; }
article h1, article h2, article h3, article h4, article h5, article h6 { font-weight: 600; line-height: 1.25; color: #111827; break-after: avoid; }
article h1 { font-size: 17pt; margin: 18pt 0 8pt; }
article h2 { font-size: 15pt; margin: 16pt 0 7pt; }
article h3 { font-size: 13pt; margin: 14pt 0 6pt; }
article h4, article h5, article h6 { font-size: 11.5pt; margin: 12pt 0 5pt; }
article p { margin: 0 0 8pt; orphans: 3; widows: 3; }
article ul, article ol { margin: 0 0 8pt; padding-left: 18pt; }
article li { margin-bottom: 3pt; }
article blockquote { margin: 10pt 0; padding: 2pt 0 2pt 12pt; border-left: 3px solid #c7cbe0; color: #374151; font-style: italic; }
article pre { font-family: "Courier New", monospace; font-size: 9pt; background: #f5f6fa; border: 1px solid #e3e5ee; border-radius: 4pt; padding: 8pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
article code { font-family: "Courier New", monospace; font-size: 9.5pt; }
article table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-family: "Inter", Arial, sans-serif; font-size: 9pt; break-inside: auto; }
article th, article td { border: 1px solid #d6d9e4; padding: 4pt 6pt; text-align: left; vertical-align: top; }
article th { background: #f5f6fa; font-weight: 600; }
article a { color: #3730a3; text-decoration: underline; word-break: break-word; }
article hr { border: none; border-top: 1px solid #d6d9e4; margin: 14pt 0; }
</style>
</head>
<body>
<header class="snapshot">
<p class="kicker">Imported from the web for personal study</p>
<h1>${title}</h1>
<dl>
<dt>Source</dt><dd>${url}</dd>
<dt>Retrieved</dt><dd>${escapeHtml(formatDate(input.retrievedAt))}</dd>
</dl>
</header>
<article>
${input.bodyHtml}
</article>
</body>
</html>`;
}

/** Puppeteer header and footer: escaped title and page numbers (Section 26). */
export function webSnapshotHeaderFooter(title: string): {
  headerTemplate: string;
  footerTemplate: string;
} {
  const style =
    'style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #6b7280; width: 100%; padding: 0 20mm;"';
  return {
    headerTemplate: `<div ${style}><span style="display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title.slice(0, 120))}</span></div>`,
    footerTemplate: `<div ${style}><span>Imported from the web for personal study</span><span style="float:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  };
}
