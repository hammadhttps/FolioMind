import type { ProjectPageSize, ProjectTemplate } from "@foliomind/contracts";

/*
 * Print styles for the two launch templates (Section 8). Exported pages are
 * print-friendly: white paper, dark ink, restrained color. The warm paper is the
 * editor's preview surface only (Section 19).
 */

const SHARED = (pageSize: ProjectPageSize, margin: string) => `
@page { size: ${pageSize}; margin: ${margin}; }
* { box-sizing: border-box; }
html { background: #ffffff; color: #1f2937; }
body { margin: 0; }
@media screen {
  body { max-width: 720px; margin: 0 auto; padding: 32px 24px 48px; }
}
h1, h2, h3 { break-after: avoid; color: #111827; }
p { orphans: 3; widows: 3; }
/* Print clips at the page area, and half of a collapsed outer border sits outside the table. */
table { border-collapse: collapse; width: calc(100% - 1pt); margin-left: 0.5pt; break-inside: auto; }
tr { break-inside: avoid; }
th, td { vertical-align: top; text-align: left; }
th p, td p { margin: 0; }
.cover { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; }
.contents ol { list-style: none; padding: 0; }
.page-break { break-after: page; }
.ai-label { font-family: "Inter", Arial, sans-serif; font-size: 8.5pt; font-weight: 600; }
.references ol { padding-left: 20pt; }
.references li { margin-bottom: 3pt; }
.fm-cite { font-size: 0.72em; vertical-align: super; line-height: 0; color: #3730a3; font-family: "Inter", Arial, sans-serif; }
`;

const ACADEMIC = `
body { font-family: "Source Serif 4", Georgia, serif; font-size: 11.5pt; line-height: 1.55; }
.title-block { text-align: center; border-bottom: 1px solid #c9ccd8; padding-bottom: 14pt; margin-bottom: 20pt; }
.title-block h1, .cover h1 { font-weight: 600; font-size: 24pt; line-height: 1.2; margin: 0 0 8pt; }
.cover { align-items: center; text-align: center; }
.meta { font-family: "Inter", Arial, sans-serif; font-size: 9pt; color: #4b5563; margin: 0 0 3pt; }
.ai-label { color: #92400e; margin: 8pt 0 0; }
article h1 { font-weight: 600; font-size: 18pt; line-height: 1.25; margin: 20pt 0 8pt; }
article h2 { font-weight: 600; font-size: 15pt; line-height: 1.25; margin: 18pt 0 7pt; }
article h3 { font-weight: 600; font-style: italic; font-size: 12.5pt; line-height: 1.3; margin: 13pt 0 5pt; }
article p { margin: 0 0 8pt; }
article ul, article ol { margin: 0 0 8pt; padding-left: 20pt; }
article li { margin-bottom: 3pt; }
article li p { margin: 0; }
article table { margin: 10pt 0 12pt; font-family: "Inter", Arial, sans-serif; font-size: 9pt; }
article th, article td { border: 1px solid #c9ccd8; padding: 4pt 6pt; }
article th { font-weight: 600; background: #f3f4f8; }
.contents h2, .references h2 { font-weight: 600; font-size: 15pt; margin: 0 0 10pt; }
.references { margin-top: 24pt; border-top: 1px solid #c9ccd8; padding-top: 12pt; font-size: 10pt; }
.contents li { padding: 3pt 0; border-bottom: 1px dotted #c9ccd8; }
`;

const STUDY_NOTES = `
body { font-family: "Inter", Arial, sans-serif; font-size: 10pt; line-height: 1.55; }
.title-block { border-left: 4pt solid #0f766e; padding: 2pt 0 2pt 12pt; margin-bottom: 18pt; }
.title-block h1, .cover h1 { font-family: "Source Serif 4", Georgia, serif; font-weight: 600; font-size: 21pt; line-height: 1.2; margin: 0 0 5pt; }
.cover { border-left: 6pt solid #0f766e; padding-left: 18pt; }
.meta { font-size: 8.5pt; color: #4b5563; margin: 0 0 2pt; }
.ai-label { color: #92400e; margin: 6pt 0 0; }
article h1 { font-family: "Source Serif 4", Georgia, serif; font-weight: 600; font-size: 15pt; margin: 16pt 0 6pt; }
article h2 { font-weight: 600; font-size: 12pt; line-height: 1.3; margin: 16pt 0 6pt; padding: 4pt 8pt; background: #f0fdfa; border-left: 3pt solid #0f766e; color: #115e59; }
article h3 { font-weight: 600; font-size: 10.5pt; margin: 11pt 0 3pt; color: #3730a3; }
article p { margin: 0 0 6pt; }
article ul, article ol { margin: 0 0 6pt; padding-left: 16pt; }
article li { margin-bottom: 2pt; }
article li p { margin: 0; }
article strong { font-weight: 600; }
article table { margin: 8pt 0 10pt; font-size: 8.5pt; }
article th, article td { border-bottom: 1px solid #d6d9e4; padding: 3pt 5pt; }
article th { font-weight: 600; border-bottom: 1.5pt solid #0f766e; }
.contents h2, .references h2 { font-weight: 600; font-size: 12pt; margin: 0 0 8pt; color: #115e59; }
.references { margin-top: 18pt; border-top: 1.5pt solid #0f766e; padding-top: 8pt; font-size: 8.5pt; }
.contents li { padding: 2pt 0; }
`;

export function projectStyles(template: ProjectTemplate, pageSize: ProjectPageSize): string {
  return template === "study-notes"
    ? SHARED(pageSize, "18mm 18mm 20mm") + STUDY_NOTES
    : SHARED(pageSize, "25mm 24mm 25mm") + ACADEMIC;
}
