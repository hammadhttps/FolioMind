import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  ExtractionMode,
  ExtractionOutcome,
  RawLine,
  RawPage,
} from "@foliomind/workflows/worker-a";

/*
 * Restricted PDF parsing (blueprint Section 8 step 1), run as a child process
 * that the parent starts with a memory cap and kills on a hard timeout. It
 * checks the `%PDF-` signature, parses with the pdfjs-dist legacy build (no
 * scripting, no XFA, no font loading), refuses password-protected files and
 * returns text lines with their font size and position. Nothing here touches
 * the network, the database or secrets.
 */

interface Request {
  filePath: string;
  mode: ExtractionMode;
  maxPages: number;
}

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

function reply(outcome: ExtractionOutcome): void {
  process.send?.(outcome, () => process.exit(0));
}

interface TextItem {
  str: string;
  transform: number[];
  hasEOL: boolean;
}

function linesOf(items: readonly unknown[]): RawLine[] {
  const lines: RawLine[] = [];
  let text = "";
  let size = 0;
  let y: number | null = null;
  let lastX: number | null = null;

  const flush = () => {
    if (text.trim()) lines.push({ text, size: Math.round(size * 100) / 100, y: y ?? 0 });
    text = "";
    size = 0;
    y = null;
    lastX = null;
  };

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as TextItem;
    const [a = 0, b = 0, c = 0, d = 0, x = 0, itemY = 0] = item.transform;
    const itemSize = Math.hypot(c, d) || Math.hypot(a, b);
    if (y !== null && Math.abs(itemY - y) > Math.max(itemSize, size) * 0.6) flush();
    if (item.str) {
      if (
        text &&
        lastX !== null &&
        !/\s$/.test(text) &&
        !/^\s/.test(item.str) &&
        x - lastX > itemSize * 0.15
      ) {
        text += " ";
      }
      text += item.str;
      if (item.str.trim()) size = Math.max(size, itemSize);
      y ??= itemY;
      lastX = x + item.str.length * itemSize * 0.45;
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

async function run({ filePath, mode, maxPages }: Request): Promise<ExtractionOutcome> {
  const data = new Uint8Array(await readFile(filePath));
  // The signature check never trusts the declared type (Section 25).
  const head = Buffer.from(data.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) return { ok: false, code: "invalid_pdf" };

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data,
    verbosity: 0,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    // pdfjs wants a forward-slash directory with a trailing slash, also on Windows.
    standardFontDataUrl: `${path.join(pdfjsRoot, "standard_fonts").replaceAll("\\", "/")}/`,
  });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    return { ok: false, code: name === "PasswordException" ? "encrypted_pdf" : "invalid_pdf" };
  }
  try {
    const pageCount = document.numPages;
    if (pageCount < 1) return { ok: false, code: "invalid_pdf" };
    if (pageCount > maxPages) return { ok: false, code: "too_many_pages" };
    if (mode === "validate") return { ok: true, pageCount, pages: [] };

    const labels = await document.getPageLabels().catch(() => null);
    const pages: RawPage[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const label = labels?.[pageNumber - 1]?.trim() || null;
      pages.push({
        pageNumber,
        label: label && label !== String(pageNumber) ? label.slice(0, 40) : null,
        lines: linesOf(content.items),
      });
      page.cleanup();
    }
    return { ok: true, pageCount, pages };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

process.once("message", (message: Request) => {
  run(message)
    .then(reply)
    .catch((error: unknown) => {
      // Not the file's fault: exit with a failure so the step retries. Error names only.
      console.error(`extraction failed: ${(error as { name?: string })?.name ?? "Error"}`);
      process.exit(1);
    });
});
