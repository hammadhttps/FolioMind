import path from "node:path";
import { processPages } from "@foliomind/workflows/worker-a";
import { describe, expect, it } from "vitest";
import { createWorkerExtractor } from "./extract";

/*
 * The sandboxed extractor against the committed fixtures
 * (`pnpm --filter worker-ingestion fixtures` regenerates them).
 */

const fixture = (name: string) => path.resolve(import.meta.dirname, "../test/fixtures", name);
const extract = createWorkerExtractor({ timeoutMs: 60_000 });
const options = { mode: "extract", maxPages: 150 } as const;

describe("extraction child process", () => {
  it("reads a structured text PDF page by page", async () => {
    const outcome = await extract(fixture("structured.pdf"), options);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.pageCount).toBe(3);
    const { pages, quality } = processPages(outcome.pages);
    expect(quality.needsOcr).toBe(false);
    // Three running headers and three page footers are removed.
    expect(quality.removedRepeatedLines).toBe(6);
    expect(pages[0]!.headings.map((heading) => heading.text)).toEqual([
      "Field Notes on River Restoration",
      "1. Mapping the Channel",
    ]);
    expect(pages[1]!.text).toMatch(/^2\. Planting the Banks\n\n/);
    expect(pages[2]!.text).not.toContain("FolioMind Test Fixture");
  });

  it("keeps the two columns of a multi-column PDF apart", async () => {
    const outcome = await extract(fixture("two-column.pdf"), options);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { pages } = processPages(outcome.pages);
    // Each column's paragraphs stay whole rather than interleaving line by line.
    expect(pages[0]!.text).toContain(
      "Rivers carry sediment from the hills to the sea. Restoration projects begin by mapping where",
    );
  });

  it("counts pages only in validate mode", async () => {
    const outcome = await extract(fixture("structured.pdf"), { mode: "validate", maxPages: 150 });
    expect(outcome).toEqual({ ok: true, pageCount: 3, pages: [] });
  });

  it("flags a scanned, image-only PDF for OCR", async () => {
    const outcome = await extract(fixture("scanned.pdf"), options);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(processPages(outcome.pages).quality.needsOcr).toBe(true);
  });

  it.each([
    ["encrypted.pdf", "encrypted_pdf"],
    ["malformed.pdf", "invalid_pdf"],
    ["not-a-pdf.pdf", "invalid_pdf"],
    ["151-pages.pdf", "too_many_pages"],
  ])("refuses %s as %s", async (name, code) => {
    expect(await extract(fixture(name), options)).toEqual({ ok: false, code });
  });

  it("kills a parse that runs past its time limit", async () => {
    const slow = createWorkerExtractor({ timeoutMs: 1 });
    expect(await slow(fixture("151-pages.pdf"), options)).toEqual({
      ok: false,
      code: "extraction_timeout",
    });
  });
});
