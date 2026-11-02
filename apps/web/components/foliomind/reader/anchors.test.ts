import { describe, expect, it } from "vitest";
import { normalizeRects, quotedText } from "./anchors";

const page = { left: 100, top: 50, width: 600, height: 800 };

describe("normalizeRects", () => {
  it("stores rectangles as fractions of the page, so highlights survive zoom", () => {
    const [rect] = normalizeRects([{ left: 160, top: 130, width: 300, height: 20 }], page);
    expect(rect!.x).toBeCloseTo(0.1);
    expect(rect!.y).toBeCloseTo(0.1);
    expect(rect!.w).toBeCloseTo(0.5);
    expect(rect!.h).toBeCloseTo(0.025);
  });

  it("clips to the page, drops slivers and merges duplicates", () => {
    const rects = normalizeRects(
      [
        { left: 50, top: 60, width: 200, height: 20 }, // starts left of the page
        { left: 300, top: 300, width: 0.5, height: 20 }, // sliver
        { left: 300, top: 300, width: 100, height: 20 },
        { left: 300.2, top: 300.1, width: 100, height: 20 }, // duplicate
        { left: 900, top: 300, width: 100, height: 20 }, // off the page
      ],
      page,
    );
    expect(rects).toHaveLength(2);
    expect(rects[0]!.x).toBe(0);
    expect(rects.every((rect) => rect.x + rect.w <= 1 && rect.y + rect.h <= 1)).toBe(true);
  });

  it("caps the number of rectangles", () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      left: 100,
      top: 50 + index * 5,
      width: 300,
      height: 4,
    }));
    expect(normalizeRects(many, page)).toHaveLength(100);
  });
});

describe("quotedText", () => {
  it("reads PDF.js line breaks as spaces", () => {
    const layer = document.createElement("div");
    layer.innerHTML =
      '<span>begin by mapping where</span><br role="presentation"><span>that sediment settles.</span>';
    document.body.append(layer);
    const range = document.createRange();
    range.selectNodeContents(layer);
    expect(quotedText(range)).toBe("begin by mapping where that sediment settles.");
    layer.remove();
  });
});
