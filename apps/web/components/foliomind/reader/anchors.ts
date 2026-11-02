import type { AnnotationAnchor } from "@foliomind/contracts";

/*
 * Turning a text selection in the PDF.js text layer into a stored anchor
 * (blueprint Section 8: highlight coordinates come from the text layer): the
 * page number, the quoted text, its character offsets in the page's text layer
 * and rectangles as fractions of the page, so highlights survive any zoom.
 */

export type SelectionAnchor = Required<
  Pick<AnnotationAnchor, "page" | "text" | "start" | "end">
> & {
  rects: NonNullable<AnnotationAnchor["rects"]>;
};

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Client rectangles → page fractions, dropping slivers and merging duplicates. */
export function normalizeRects(
  rects: readonly { left: number; top: number; width: number; height: number }[],
  page: Box,
): SelectionAnchor["rects"] {
  const result: SelectionAnchor["rects"] = [];
  for (const rect of rects) {
    if (rect.width < 1 || rect.height < 1) continue;
    const x = clamp((rect.left - page.left) / page.width);
    const y = clamp((rect.top - page.top) / page.height);
    const right = clamp((rect.left + rect.width - page.left) / page.width);
    const bottom = clamp((rect.top + rect.height - page.top) / page.height);
    if (right - x <= 0 || bottom - y <= 0) continue;
    const next = { x, y, w: right - x, h: bottom - y };
    const duplicate = result.some(
      (seen) =>
        Math.abs(seen.x - next.x) < 0.002 &&
        Math.abs(seen.y - next.y) < 0.002 &&
        Math.abs(seen.w - next.w) < 0.002 &&
        Math.abs(seen.h - next.h) < 0.002,
    );
    if (!duplicate) result.push(next);
  }
  return result.slice(0, 100);
}

/** The selected text, with PDF.js's line-break elements read as spaces. */
export function quotedText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith(" "));
  return (fragment.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/**
 * The anchor for the current selection inside `container`, or null when there
 * is no usable selection. A selection spanning pages is clipped to its first
 * page.
 */
export function anchorFromSelection(
  container: HTMLElement,
  selection: Selection | null,
): SelectionAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const page = elementOf(range.startContainer)?.closest<HTMLElement>(".page[data-page-number]");
  const textLayer = page?.querySelector<HTMLElement>(".textLayer");
  if (
    !page ||
    !textLayer ||
    !container.contains(page) ||
    !textLayer.contains(range.startContainer)
  ) {
    return null;
  }
  if (!textLayer.contains(range.endContainer)) {
    range.setEnd(textLayer, textLayer.childNodes.length);
  }

  const text = quotedText(range);
  if (!text) return null;
  const before = document.createRange();
  before.selectNodeContents(textLayer);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;

  // The page's inner box (inside PDF.js's page border), which highlights cover.
  const outer = page.getBoundingClientRect();
  const box = {
    left: outer.left + page.clientLeft,
    top: outer.top + page.clientTop,
    width: page.clientWidth,
    height: page.clientHeight,
  };
  const rects = normalizeRects(Array.from(range.getClientRects()), box);
  if (rects.length === 0) return null;
  return {
    page: Number(page.dataset.pageNumber),
    text,
    start,
    end: start + range.toString().length,
    rects,
  };
}
