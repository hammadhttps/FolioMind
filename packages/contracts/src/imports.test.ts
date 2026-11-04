import { describe, expect, it } from "vitest";
import { checkImportUrl, countWords, importUrlFormSchema } from "./imports";

describe("checkImportUrl (Section 27 step 1)", () => {
  it.each([
    "https://example.com/articles/rivers",
    "http://blog.example.org/post?id=4#comments",
    "  https://news.example.co.uk/a  ",
  ])("accepts %s", (url) => {
    expect(checkImportUrl(url).ok).toBe(true);
  });

  it.each([
    ["not a url", "invalid"],
    ["ftp://example.com/file", "invalid"],
    ["javascript:alert(1)", "invalid"],
    ["https://user:pass@example.com/", "credentials"],
    ["http://127.0.0.1/", "ip_address"],
    ["http://2130706433/", "ip_address"],
    ["http://0x7f.0.0.1/", "ip_address"],
    ["http://10.0.0.8/admin", "ip_address"],
    ["http://169.254.169.254/latest/meta-data", "ip_address"],
    ["http://[::1]/", "ip_address"],
    ["http://[fd00::1]/", "ip_address"],
    ["http://localhost:3000/", "local"],
    ["http://app.localhost/", "local"],
    ["http://printer.local/", "local"],
    ["http://intranet/", "local"],
    ["http://metadata.google.internal/", "local"],
    ["https://folio-mind-two.vercel.app/dashboard", "own_site"],
    ["https://docs.example.com/paper.pdf", "pdf"],
    [`https://example.com/${"a".repeat(2100)}`, "too_long"],
  ])("refuses %s as %s", (url, code) => {
    const result = checkImportUrl(url, ["folio-mind-two.vercel.app"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it("drops the fragment", () => {
    const result = checkImportUrl("https://example.com/a#section-2");
    expect(result.ok && result.url.toString()).toBe("https://example.com/a");
  });

  it("requires the rights confirmation in the form schema", () => {
    const url = "https://example.com/a";
    expect(importUrlFormSchema.safeParse({ url, rightsConfirmed: false }).success).toBe(false);
    expect(importUrlFormSchema.safeParse({ url, rightsConfirmed: true }).success).toBe(true);
  });
});

describe("countWords", () => {
  it("counts runs of letters and digits, including other scripts", () => {
    expect(countWords("Rivers carry 3 kinds of sediment — don't they?")).toBe(8);
    expect(countWords("Ríos y sedimentos")).toBe(3);
    expect(countWords("## \n\n *** ")).toBe(0);
  });
});
