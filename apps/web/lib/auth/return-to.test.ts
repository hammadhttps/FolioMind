import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_TO, loginHref, safeReturnTo, signInPageHref } from "./return-to";
import {
  AUTH_NOTICES,
  authNoticeMessage,
  isSocialConnection,
  signInErrorMessage,
  SIGN_IN_ERRORS,
} from "./sign-in-errors";

describe("safeReturnTo", () => {
  it("keeps local paths with their query and hash", () => {
    expect(safeReturnTo("/dashboard/library?type=saved#top")).toBe(
      "/dashboard/library?type=saved#top",
    );
    expect(safeReturnTo("/read/abc")).toBe("/read/abc");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "",
    "/auth/logout",
    "/auth",
    "/dash\u0000board",
    `/${"a".repeat(2050)}`,
  ])("falls back for %j", (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
  });

  it("falls back for non-strings and honours a custom fallback", () => {
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(42, "/library")).toBe("/library");
  });
});

describe("sign-in links", () => {
  it("sends social sign-in straight to the provider with a sanitized returnTo", () => {
    expect(loginHref({ connection: "google-oauth2", returnTo: "/dashboard?tab=research" })).toBe(
      "/auth/login?connection=google-oauth2&prompt=select_account&returnTo=%2Fdashboard%3Ftab%3Dresearch",
    );
    expect(loginHref({ connection: "github", returnTo: "https://evil.example" })).toBe(
      "/auth/login?connection=github&returnTo=%2Fdashboard",
    );
  });

  it("forces a fresh sign-in for reauthentication", () => {
    expect(
      loginHref({ connection: "google-oauth2", returnTo: "/dashboard/settings", prompt: "login" }),
    ).toBe("/auth/login?connection=google-oauth2&prompt=login&returnTo=%2Fdashboard%2Fsettings");
    expect(loginHref({ connection: "github", prompt: "login" })).toBe(
      "/auth/login?connection=github&prompt=login&returnTo=%2Fdashboard",
    );
  });

  it("points everything else at FolioMind's own sign-in page", () => {
    expect(signInPageHref("/read/abc")).toBe("/login?returnTo=%2Fread%2Fabc");
    expect(signInPageHref("//evil.example")).toBe("/login?returnTo=%2Fdashboard");
  });
});

describe("sign-in errors", () => {
  it("only lets Google and GitHub skip FolioMind's screen", () => {
    expect(isSocialConnection("google-oauth2")).toBe(true);
    expect(isSocialConnection("github")).toBe(true);
    expect(isSocialConnection("Username-Password-Authentication")).toBe(false);
    expect(isSocialConnection(null)).toBe(false);
  });

  it("maps codes to fixed copy and never echoes unknown text", () => {
    expect(signInErrorMessage("cancelled")).toBe(SIGN_IN_ERRORS.cancelled);
    expect(signInErrorMessage("<script>")).toBe(SIGN_IN_ERRORS.failed);
    expect(signInErrorMessage(undefined)).toBeNull();
    expect(signInErrorMessage("suspended")).toBe(SIGN_IN_ERRORS.suspended);
  });

  it("shows the Section 22 existing-account notice and nothing for unknown notices", () => {
    expect(authNoticeMessage("existing-account")).toBe(AUTH_NOTICES["existing-account"]);
    expect(AUTH_NOTICES["existing-account"]).toBe(
      "You already have a FolioMind account with this email. Sign in with your original method, then connect this one in Settings.",
    );
    expect(authNoticeMessage("anything-else")).toBeNull();
  });
});
