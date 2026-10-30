import { ProviderError } from "@foliomind/contracts";
import puppeteer, { type Browser, type PDFOptions } from "puppeteer-core";

const PROVIDER = "Browserless";

export interface BrowserlessConfig {
  /** e.g. wss://production-sfo.browserless.io or ws://localhost:3001 */
  wsEndpoint: string;
  token: string;
  /** Browserless session lifetime; Section 26 uses 60 seconds. */
  sessionTimeoutMs?: number;
}

export interface RenderPdfOptions {
  format?: "A4" | "Letter";
  /** Per-render timeout; Section 26 uses 30 seconds. */
  renderTimeoutMs?: number;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

/**
 * Opens one Browserless session, runs `fn`, and always closes the session
 * (Section 26: one browser session per render, closed in `finally`).
 */
export async function withBrowser<T>(
  config: BrowserlessConfig,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const endpoint = new URL(config.wsEndpoint);
  endpoint.searchParams.set("token", config.token);
  endpoint.searchParams.set("timeout", String(config.sessionTimeoutMs ?? 60_000));

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint.toString() });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replaceAll(
      config.token,
      "***",
    );
    // 429 means the Browserless plan's concurrency is exhausted: retry later.
    throw new ProviderError(PROVIDER, `could not connect: ${message}`, {
      retryable: true,
      cause: error,
    });
  }
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Renders trusted, sanitized HTML to PDF with the Section 26 hardening:
 * JavaScript disabled and every request aborted except `data:` URLs, so the
 * renderer fetches nothing and never navigates to user-supplied URLs.
 */
export async function renderHtmlToPdf(
  config: BrowserlessConfig,
  html: string,
  options: RenderPdfOptions = {},
): Promise<Uint8Array> {
  const timeout = options.renderTimeoutMs ?? 30_000;
  return withBrowser(config, async (browser) => {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.isInterceptResolutionHandled()) return;
      if (request.url().startsWith("data:")) void request.continue();
      else void request.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout });

    const pdfOptions: PDFOptions = {
      format: options.format ?? "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout,
    };
    if (options.displayHeaderFooter) {
      pdfOptions.displayHeaderFooter = true;
      if (options.headerTemplate) pdfOptions.headerTemplate = options.headerTemplate;
      if (options.footerTemplate) pdfOptions.footerTemplate = options.footerTemplate;
    }
    return page.pdf(pdfOptions);
  });
}
