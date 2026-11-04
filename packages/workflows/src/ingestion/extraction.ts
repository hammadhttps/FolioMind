/*
 * The contract between Worker A's extraction child process and the ingestion
 * function (blueprint Section 8 step 1). The child parses the PDF with
 * pdfjs-dist in a separate, memory- and time-bounded process and returns raw
 * text lines with their font size and vertical position; everything else
 * (normalizing, headings, chunks) happens in pure functions here.
 */

export interface RawLine {
  text: string;
  /** Font size in PDF units. */
  size: number;
  /** Baseline height from the bottom of the page, in PDF units. */
  y: number;
}

export interface RawPage {
  pageNumber: number;
  /** Printed page label (e.g. "iv"), when the PDF defines one. */
  label: string | null;
  lines: RawLine[];
}

export type ExtractionFailure =
  "invalid_pdf" | "encrypted_pdf" | "too_many_pages" | "extraction_timeout";

export type ExtractionOutcome =
  { ok: true; pageCount: number; pages: RawPage[] } | { ok: false; code: ExtractionFailure };

/** "validate" parses and counts pages only; "extract" also returns every page's lines. */
export type ExtractionMode = "validate" | "extract";

export type Extractor = (
  filePath: string,
  options: { mode: ExtractionMode; maxPages: number },
) => Promise<ExtractionOutcome>;
