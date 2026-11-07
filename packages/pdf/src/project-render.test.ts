import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectDoc } from "@foliomind/contracts";
import { describe, expect, it } from "vitest";
import { renderHtmlToPdf, type BrowserlessConfig } from "./browserless";
import { projectDocumentHtml, projectHeaderFooter } from "./project-html";

/*
 * The real render, against the Browserless container (Phase 8 skill): page
 * count, embedded fonts and no network requests. Skips with a message when the
 * container isn't running.
 */

const config: BrowserlessConfig = {
  wsEndpoint: process.env.BROWSERLESS_WS_ENDPOINT ?? "ws://localhost:3001",
  token: process.env.BROWSERLESS_TOKEN ?? "foliomind-local-dev-token",
};

const healthUrl = config.wsEndpoint.replace(/^ws/, "http");
const available = await fetch(`${healthUrl}/pressure?token=${config.token}`, {
  signal: AbortSignal.timeout(2000),
})
  .then((response) => response.ok)
  .catch(() => false);

const VERSION = "11111111-1111-4111-8111-111111111111";

function longDoc(sections: number): ProjectDoc {
  const content: ProjectDoc["content"] = [];
  for (let section = 1; section <= sections; section += 1) {
    content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: `Section ${section}: urban heat` }],
    });
    for (let paragraph = 0; paragraph < 8; paragraph += 1) {
      content.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Street trees and reflective roofs lower summer temperatures in dense districts, and the effect grows when both are used together across a neighbourhood. ".repeat(
              3,
            ),
          },
          {
            type: "citation",
            attrs: {
              label: "1",
              chunkId: null,
              versionId: VERSION,
              pageStart: 3,
              pageEnd: 3,
              draftHash: null,
            },
          },
        ],
      });
    }
  }
  return { type: "doc", content };
}

async function inspect(pdf: Uint8Array) {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const pdfjs = (await import(
    pathToFileURL(path.join(root, "legacy/build/pdf.mjs")).href
  )) as typeof import("pdfjs-dist");
  const document = await pdfjs.getDocument({
    data: pdf.slice(),
    verbosity: 0,
    fontExtraProperties: true,
  }).promise;
  const fonts = new Set<string>();
  const words: string[] = [];
  // The cover, the contents and the first page of the body.
  for (const pageNumber of [1, 2, 3]) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    await page.getOperatorList();
    words.push(...text.items.map((item) => ("str" in item ? item.str : "")));
    for (const name of Object.keys(text.styles)) {
      const font = page.commonObjs.has(name)
        ? (page.commonObjs.get(name) as { name?: string; missingFile?: boolean })
        : null;
      if (font?.name) fonts.add(`${font.name}${font.missingFile ? " (not embedded)" : ""}`);
    }
  }
  return { pages: document.numPages, fonts: [...fonts], text: words.join(" ") };
}

const describeRender = available ? describe : describe.skip;
if (!available) {
  console.warn(`Skipping render tests: no Browserless at ${healthUrl}. Run pnpm stack:up.`);
}

describeRender.each([
  ["academic-report", "SourceSerif"],
  ["study-notes", "Inter"],
] as const)("the %s template in Chromium", (template, bodyFont) => {
  const input = {
    title: "Cities and heat",
    mode: "research" as const,
    template,
    pageSize: "A4" as const,
    cover: true,
    contents: true,
    date: new Date("2026-11-07T00:00:00Z"),
    doc: longDoc(6),
    sources: [{ versionId: VERSION, title: "Harbor Plan" }],
  };

  it(
    "renders several pages with its fonts embedded and no network requests",
    { timeout: 60_000 },
    async () => {
      const blocked: string[] = [];
      const started = Date.now();
      const pdf = await renderHtmlToPdf(config, projectDocumentHtml(input), {
        format: input.pageSize,
        displayHeaderFooter: true,
        accessible: true,
        onBlockedRequest: (url) => blocked.push(url),
        ...projectHeaderFooter(input),
      });
      const result = await inspect(pdf);
      console.info(
        `${template}: ${result.pages} pages, ${pdf.byteLength} bytes, ${Date.now() - started} ms, fonts ${result.fonts.join(", ")}`,
      );
      expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
      expect(result.pages).toBeGreaterThan(3);
      expect(blocked).toEqual([]);
      expect(result.text).toContain("Cities and heat");
      expect(result.fonts.some((font) => font.includes(bodyFont))).toBe(true);
      expect(result.fonts.filter((font) => font.includes("not embedded"))).toEqual([]);
    },
  );
});

describeRender("the renderer", () => {
  it("aborts anything a page tries to load, and records it", { timeout: 60_000 }, async () => {
    const blocked: string[] = [];
    await renderHtmlToPdf(
      config,
      '<!doctype html><html><body><img src="http://127.0.0.1:9/track.png"><p>Hi</p></body></html>',
      { onBlockedRequest: (url) => blocked.push(url) },
    );
    expect(blocked).toEqual(["http://127.0.0.1:9/track.png"]);
  });
});
