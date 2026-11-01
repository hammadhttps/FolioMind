import { PasswordlessStartError, PasswordlessVerifyError } from "@auth0/nextjs-auth0/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startEmailSignIn, verifyEmailCode } from "./email-sign-in";

const { start, verify } = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn() }));

vi.mock("@/lib/auth0", () => ({ auth0: { passwordless: { start, verify } } }));
vi.mock("@/lib/rate-limit", () => ({
  checkLimits: vi.fn(async () => ({ ok: true })),
  clientIpIdentifier: vi.fn(async () => "ip:test"),
  hmacIdentifier: (value: string) => value,
}));

const email = "ada@example.com";
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  start.mockReset();
  verify.mockReset();
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

describe("startEmailSignIn", () => {
  it("maps Auth0's bad.email to a field error", async () => {
    start.mockRejectedValue(new PasswordlessStartError("bad.email", "email is invalid"));
    await expect(startEmailSignIn({ email })).resolves.toEqual({
      ok: false,
      code: "bad.email",
      fieldErrors: { email: ["Enter a valid email address."] },
    });
  });

  it("maps Auth0's too_many_requests to a rate-limit message", async () => {
    start.mockRejectedValue(new PasswordlessStartError("too_many_requests", "Too many requests"));
    await expect(startEmailSignIn({ email })).resolves.toMatchObject({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 60,
    });
  });

  it("logs Auth0's reason without the address for other errors", async () => {
    start.mockRejectedValue(
      new PasswordlessStartError("bad.connection", `Connection is disabled for ${email}`),
    );
    await expect(startEmailSignIn({ email })).resolves.toMatchObject({
      ok: false,
      code: "unavailable",
    });
    const line = String(logged.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "email_sign_in_failed",
      step: "start",
      code: "bad.connection",
      description: "Connection is disabled for [email]",
    });
    expect(line).not.toContain(email);
  });
});

describe("verifyEmailCode", () => {
  it("maps Auth0's invalid_grant to a code field error", async () => {
    verify.mockRejectedValue(
      new PasswordlessVerifyError("invalid_grant", "Wrong email or verification code."),
    );
    await expect(verifyEmailCode({ email, code: "123456" })).resolves.toEqual({
      ok: false,
      code: "invalid_grant",
      fieldErrors: { code: ["That code didn't work. Check it, or send a new code."] },
    });
  });

  it("maps Auth0's too_many_attempts to a form error", async () => {
    verify.mockRejectedValue(new PasswordlessVerifyError("too_many_attempts", "Too many attempts"));
    await expect(verifyEmailCode({ email, code: "123456" })).resolves.toMatchObject({
      ok: false,
      code: "too_many_attempts",
      formError: "Too many attempts. Send a new code to try again.",
    });
  });
});
