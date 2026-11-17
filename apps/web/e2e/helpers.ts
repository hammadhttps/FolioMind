import { randomUUID } from "node:crypto";
import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";

/** True when Playwright runs against `pnpm start` (CI); locally it reuses `pnpm dev`. */
export const isProductionServer = Boolean(process.env.CI);

/**
 * A notFound() after a loading.tsx fallback has streamed can't change the
 * status; Next renders the not-found UI in place and React reports the boundary
 * switch as recoverable error #419 (production builds only), as a console error
 * or an uncaught page error.
 */
const STREAMED_NOT_FOUND = "Minified React error #419";

/** Collects console errors and uncaught exceptions while a test runs. */
export function watchConsole(page: Page, { allowNotFound = false } = {}) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // The document request of a not-found page is itself a 404.
    if (allowNotFound && text.includes("status of 404")) return;
    if (allowNotFound && text.includes(STREAMED_NOT_FOUND)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => {
    if (allowNotFound && error.message.includes(STREAMED_NOT_FOUND)) return;
    errors.push(error.message);
  });
  return errors;
}

/** Fails when the page scrolls sideways at the current viewport width (Section 19). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

/**
 * A second browser (another user, a guest). `browser.newContext()` doesn't get
 * the config's per-worker `x-real-ip`, so without this every extra context in
 * every worker would share one client for the 300-a-minute global limit.
 */
export function newClient(browser: Browser, options: BrowserContextOptions = {}) {
  return browser.newContext({
    ...options,
    extraHTTPHeaders: { "x-real-ip": `e2e-${randomUUID()}`, ...options.extraHTTPHeaders },
  });
}
