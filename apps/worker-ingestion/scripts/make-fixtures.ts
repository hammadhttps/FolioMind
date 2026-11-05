import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { documentByKey } from "@foliomind/ai/eval";

/*
 * Writes the ingestion test fixtures (Phase 6) as hand-built PDFs, so no PDF
 * library is needed: a structured text PDF with running headers and footers,
 * a two-column PDF, a scanned (image-only) PDF, a password-protected PDF, a
 * malformed file and a 151-page PDF, plus two evaluation documents for the chat
 * end-to-end tests. Run with `pnpm --filter worker-ingestion fixtures`; the
 * output is committed under test/fixtures and apps/web/e2e/fixtures.
 */

const OUT = path.resolve(import.meta.dirname, "../test/fixtures");

const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);

interface TextRun {
  text: string;
  size: number;
  x: number;
  y: number;
  bold?: boolean;
}

const content = (runs: readonly TextRun[]) =>
  runs
    .map(
      (run) =>
        `BT /${run.bold ? "F2" : "F1"} ${run.size} Tf ${run.x} ${run.y} Td (${escape(run.text)}) Tj ET`,
    )
    .join("\n");

/** Assembles objects into a PDF with a correct cross-reference table. */
function buildPdf(
  objects: (string | Buffer)[],
  { trailerExtra = "" }: { trailerExtra?: string } = {},
): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const bodyBuffer = typeof body === "string" ? Buffer.from(body, "latin1") : body;
    const tail = Buffer.from("\nendobj\n", "latin1");
    parts.push(head, bodyBuffer, tail);
    length += head.length + bodyBuffer.length + tail.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>`,
    "startxref",
    String(length),
    "%%EOF",
    "",
  ].join("\n");
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

const stream = (body: string | Buffer, dict = "") => {
  const data = typeof body === "string" ? Buffer.from(body, "latin1") : body;
  return Buffer.concat([
    Buffer.from(`<< /Length ${data.length} ${dict}>>\nstream\n`, "latin1"),
    data,
    Buffer.from("\nendstream", "latin1"),
  ]);
};

/** A document of text pages: catalog, pages, fonts, then page and content pairs. */
function textPdf(
  pages: TextRun[][],
  trailerExtra?: string,
  extraObjects: (string | Buffer)[] = [],
) {
  const first = 5; // 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold
  const kids = pages.map((_, index) => `${first + index * 2} 0 R`).join(" ");
  const objects: (string | Buffer)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((runs, index) => {
    const contentRef = first + index * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRef} 0 R >>`,
      stream(content(runs)),
    );
  });
  return buildPdf([...objects, ...extraObjects], { trailerExtra: trailerExtra ?? "" });
}

/** Wraps prose into lines of about `width` characters. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const PARAGRAPHS = [
  "Rivers carry sediment from the hills to the sea. Restoration projects begin by mapping where that sediment settles, because the shape of a channel follows the material it carries and the floods that move it.",
  "Field teams walk each reach twice a year. They record bank height, the width of the active channel and the plants that hold the soil, so that later visits can measure change rather than guess at it.",
  "Willows and sedges stabilize banks faster than stone. Their roots bind loose soil, slow the current at the edge and give shade that keeps the water cool for fish in late summer.",
  "Communities that live beside a river often know its history better than any map. Interviews with farmers and fishers reveal old channels, lost wetlands and the years when floods changed everything.",
  "Monitoring continues for a decade after planting. Success is measured not by a single season but by whether the river can rebuild its own banks after the next great flood.",
];

/** Body paragraphs laid out from `y` downward; returns the runs and the next y. */
function layout(paragraphs: readonly string[], y: number, x = 72, width = 88, size = 11) {
  const runs: TextRun[] = [];
  for (const paragraph of paragraphs) {
    for (const line of wrap(paragraph, width)) {
      runs.push({ text: line, size, x, y });
      y -= size * 1.35;
    }
    y -= size * 1.2;
  }
  return { runs, y };
}

function structuredPdf(): Buffer {
  const pages: TextRun[][] = [];
  const chapters = ["Mapping the Channel", "Planting the Banks", "Listening to the Community"];
  chapters.forEach((chapter, index) => {
    const runs: TextRun[] = [
      { text: "FolioMind Test Fixture - Field Notes", size: 9, x: 72, y: 760 },
      ...(index === 0
        ? [{ text: "Field Notes on River Restoration", size: 24, x: 72, y: 700, bold: true }]
        : []),
      { text: `${index + 1}. ${chapter}`, size: 16, x: 72, y: index === 0 ? 650 : 700, bold: true },
    ];
    // Each page orders the paragraphs differently, as real pages differ.
    const rotated = [...PARAGRAPHS.slice(index), ...PARAGRAPHS.slice(0, index)];
    const body = layout([...rotated, ...rotated.slice(0, 2)], index === 0 ? 620 : 670);
    runs.push(...body.runs, { text: `Page ${index + 1} of 3`, size: 9, x: 280, y: 40 });
    pages.push(runs);
  });
  return textPdf(pages);
}

function twoColumnPdf(): Buffer {
  const pages: TextRun[][] = [];
  for (let page = 0; page < 2; page += 1) {
    const left = layout(PARAGRAPHS.slice(0, 3), 720, 54, 44, 10);
    const right = layout(PARAGRAPHS.slice(2), 720, 320, 44, 10);
    pages.push([
      {
        text: page === 0 ? "Two Columns of River Notes" : "Continued Notes",
        size: 18,
        x: 54,
        y: 750,
        bold: true,
      },
      ...left.runs,
      ...right.runs,
    ]);
  }
  return textPdf(pages);
}

/** Pages that only draw an image, as a scanner produces: no text at all. */
function scannedPdf(): Buffer {
  const pageCount = 3;
  const pixels = Buffer.alloc(64 * 64);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37) % 256;
  const objects: (string | Buffer)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    stream(
      pixels,
      "/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 ",
    ),
  ];
  for (let i = 0; i < pageCount; i += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      stream("q 468 0 0 648 72 72 cm /Im1 Do Q"),
    );
  }
  return buildPdf(objects);
}

/* --- Standard security handler, revision 2 (RC4, 40-bit) -------------------- */

const PADDING = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);
const pad = (password: string) =>
  Buffer.concat([Buffer.from(password, "latin1"), PADDING]).subarray(0, 32);
const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

/** A PDF that needs the user password "secret": opening it without one fails. */
function encryptedPdf(): Buffer {
  const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const permissions = -44; // print and copy refused; any value works for the fixture
  const owner = rc4(md5(pad("owner-secret")).subarray(0, 5), pad("secret"));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const key = md5(pad("secret"), owner, p, id).subarray(0, 5);
  const user = rc4(key, PADDING);
  const pages = [layout(PARAGRAPHS, 700).runs];
  // Content is left unencrypted: a reader stops at the password check before reading it.
  const encryptRef = 4 + pages.length * 2 + 1;
  const hex = (buffer: Buffer) => `<${buffer.toString("hex")}>`;
  return textPdf(pages, `/Encrypt ${encryptRef} 0 R /ID [${hex(id)} ${hex(id)}] `, [
    `<< /Filter /Standard /V 1 /R 2 /O ${hex(owner)} /U ${hex(user)} /P ${permissions} >>`,
  ]);
}

function manyPagesPdf(count: number): Buffer {
  return textPdf(
    Array.from({ length: count }, (_, index) => [
      {
        text: `Page ${index + 1}: a short line of text for the page limit test.`,
        size: 12,
        x: 72,
        y: 700,
      },
    ]),
  );
}

/** An evaluation document (Phase 7) as a real PDF, for end-to-end tests of cited answers. */
function evaluationPdf(key: string): Buffer {
  return textPdf(
    documentByKey(key).pages.map((page) => {
      const heading: TextRun[] = page.heading
        ? [{ text: page.heading, size: 18, x: 72, y: 720, bold: true }]
        : [];
      return [...heading, ...layout(page.paragraphs, page.heading ? 684 : 720).runs];
    }),
  );
}

const E2E_OUT = path.resolve(import.meta.dirname, "../../web/e2e/fixtures");
mkdirSync(E2E_OUT, { recursive: true });
for (const key of ["harbor-plan", "heat-study"]) {
  const data = evaluationPdf(key);
  writeFileSync(path.join(E2E_OUT, `${key}.pdf`), data);
  console.log(`${key}.pdf: ${data.length} bytes`);
}

mkdirSync(OUT, { recursive: true });
const fixtures: Record<string, Buffer> = {
  "structured.pdf": structuredPdf(),
  "two-column.pdf": twoColumnPdf(),
  "scanned.pdf": scannedPdf(),
  "encrypted.pdf": encryptedPdf(),
  "malformed.pdf": Buffer.from(
    "%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 9 0 R\nthis is not a PDF body\n",
    "latin1",
  ),
  "not-a-pdf.pdf": Buffer.from("<html><body>Not a PDF at all</body></html>\n", "latin1"),
  "151-pages.pdf": manyPagesPdf(151),
};
for (const [name, data] of Object.entries(fixtures)) {
  writeFileSync(path.join(OUT, name), data);
  console.log(`${name}: ${data.length} bytes`);
}
