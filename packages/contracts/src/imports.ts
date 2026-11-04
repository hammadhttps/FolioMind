import { z } from "zod";

/*
 * Web article import (blueprint Section 27). The same URL rules run in the
 * browser for feedback and on the server, where FolioMind's own hosts are
 * added. Jina Reader fetches the page, so FolioMind never connects to it; the
 * rules still keep obviously local or private targets out.
 */

export const MAX_IMPORT_URL_LENGTH = 2048;
/** Section 27 step 4: roughly 200 to 60,000 words, at most 2 MB of Markdown. */
export const MIN_IMPORT_WORDS = 200;
export const MAX_IMPORT_WORDS = 60_000;
export const MAX_IMPORT_MARKDOWN_BYTES = 2 * 1024 * 1024;

export const IMPORT_URL_ERRORS = {
  invalid: "Enter a full web address that starts with http:// or https://.",
  too_long: "Use an address of 2,048 characters or fewer.",
  credentials: "Remove the user name or password from the address.",
  ip_address: "Use the site's name rather than an IP address.",
  local: "That address points to a private or local network.",
  own_site: "That's a FolioMind page. Import articles from other sites.",
  pdf: "That looks like a PDF. Download it and upload it instead.",
} as const;
export type ImportUrlError = keyof typeof IMPORT_URL_ERRORS;

const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".arpa",
];

function isIpLiteral(hostname: string): boolean {
  // WHATWG URL parsing normalizes decimal, octal and hex IPv4 forms to dotted quads.
  return hostname.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Checks one candidate URL against Section 27 step 1. `ownHosts` are
 * FolioMind's own hostnames (the deployment and APP_BASE_URL).
 */
export function checkImportUrl(
  value: string,
  ownHosts: readonly string[] = [],
): { ok: true; url: URL } | { ok: false; code: ImportUrlError } {
  const trimmed = value.trim();
  if (trimmed.length > MAX_IMPORT_URL_LENGTH) return { ok: false, code: "too_long" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "invalid" };
  if (url.username || url.password) return { ok: false, code: "credentials" };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, code: "invalid" };
  if (isIpLiteral(hostname)) return { ok: false, code: "ip_address" };
  if (
    hostname === "localhost" ||
    !hostname.includes(".") ||
    LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return { ok: false, code: "local" };
  }
  const own = ownHosts.map((host) => host.toLowerCase());
  if (own.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return { ok: false, code: "own_site" };
  }
  if (/\.pdf$/i.test(url.pathname)) return { ok: false, code: "pdf" };
  url.hash = "";
  return { ok: true, url };
}

/** Section 28 "Import from URL": a public address and the rights checkbox. */
export const importUrlFormSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Enter the article's web address.")
    .superRefine((value, ctx) => {
      const result = checkImportUrl(value);
      if (!result.ok) ctx.addIssue({ code: "custom", message: IMPORT_URL_ERRORS[result.code] });
    }),
  rightsConfirmed: z.literal(true, {
    error: "Confirm that you may save this page for personal study.",
  }),
});
export type ImportUrlFormValues = z.input<typeof importUrlFormSchema>;

/** Counts words the way Section 27's limits mean them: runs of letters or digits. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
