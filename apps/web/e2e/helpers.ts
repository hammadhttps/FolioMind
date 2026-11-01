import { expect, type Page } from "@playwright/test";

/** True when Playwright runs against `pnpm start` (CI); locally it reuses `pnpm dev`. */
export const isProductionServer = Boolean(process.env.CI);

/** Collects console errors and uncaught exceptions while a test runs. */
export function watchConsole(page: Page, { allowNotFound = false } = {}) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // The document request of a not-found page is itself a 404.
    if (allowNotFound && text.includes("status of 404")) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Fails when the page scrolls sideways at the current viewport width (Section 19). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}
