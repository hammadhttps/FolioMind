// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { expireSessionCookies, REFUSE_SESSION_HEADER } from "./session-cookies";

describe("expireSessionCookies", () => {
  it("expires the session and its chunks, keeps other cookies and drops the marker", () => {
    const request = new NextRequest("https://foliomind.test/auth/callback", {
      headers: { cookie: "__session__0=a; __session__1=b; fm_last_signin=github" },
    });
    const response = NextResponse.redirect(
      "https://foliomind.test/login?auth_notice=existing-account",
    );
    response.headers.set(REFUSE_SESSION_HEADER, "1");
    response.cookies.set("__session", "fresh-session-from-the-sdk", { path: "/", httpOnly: true });
    response.cookies.set("__txn_abc", "", { path: "/", maxAge: 0 });

    expireSessionCookies(response, request);

    const setCookies = response.headers.getSetCookie();
    for (const name of ["__session", "__session__0", "__session__1"]) {
      const header = setCookies.find((value) => value.startsWith(`${name}=`));
      expect(header, name).toMatch(/Max-Age=0/i);
    }
    expect(setCookies.join("\n")).not.toContain("fresh-session-from-the-sdk");
    expect(setCookies.some((value) => value.startsWith("fm_last_signin="))).toBe(false);
    expect(setCookies.some((value) => value.startsWith("__txn_abc="))).toBe(true);
    expect(response.headers.has(REFUSE_SESSION_HEADER)).toBe(false);
  });
});
