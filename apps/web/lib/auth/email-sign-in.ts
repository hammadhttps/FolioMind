"use server";

import { PasswordlessStartError, PasswordlessVerifyError } from "@auth0/nextjs-auth0/errors";
import {
  emailSignInStartSchema,
  emailSignInVerifySchema,
  type ActionResult,
} from "@foliomind/contracts/forms";
import { z } from "zod";
import { auth0 } from "@/lib/auth0";
import { checkLimits, clientIpIdentifier, hmacIdentifier } from "@/lib/rate-limit";

/*
 * Email sign-in on FolioMind's own screen: Auth0 Passwordless sends a 6-digit
 * code and the SDK verifies it and creates the session, so Auth0's hosted login
 * page is never shown. Logs carry error codes only, never addresses or codes.
 */

const UNAVAILABLE =
  "Email sign-in isn't available right now. Try Google or GitHub, or try again later.";

const notConfigured: ActionResult = { ok: false, code: "not_configured", formError: UNAVAILABLE };

function rateLimited(retryAfterSeconds: number, unavailable?: boolean): ActionResult {
  return unavailable
    ? { ok: false, code: "unavailable", formError: UNAVAILABLE }
    : {
        ok: false,
        code: "rate_limited",
        retryAfterSeconds,
        formError: `You're going a little fast. Try again in ${retryAfterSeconds} seconds.`,
      };
}

function logFailure(step: "start" | "verify", code: string) {
  console.error(JSON.stringify({ event: "email_sign_in_failed", step, code }));
}

export async function startEmailSignIn(input: unknown): Promise<ActionResult> {
  const parsed = emailSignInStartSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  if (!auth0) return notConfigured;

  const { email } = parsed.data;
  const limit = await checkLimits([
    { name: "email-start-ip", identifier: await clientIpIdentifier(), tokens: 5, window: "10 m" },
    {
      name: "email-start-address",
      identifier: `email:${hmacIdentifier(email)}`,
      tokens: 3,
      window: "10 m",
    },
  ]);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds, limit.unavailable);

  try {
    await auth0.passwordless.start({ connection: "email", email, send: "code" });
    return { ok: true, data: undefined };
  } catch (error) {
    const code = error instanceof PasswordlessStartError ? error.code : "unexpected_error";
    logFailure("start", code);
    if (code === "bad.email") {
      return { ok: false, code, fieldErrors: { email: ["Enter a valid email address."] } };
    }
    if (code === "too_many_requests") return rateLimited(60);
    return { ok: false, code: "unavailable", formError: UNAVAILABLE };
  }
}

export async function verifyEmailCode(input: unknown): Promise<ActionResult> {
  const parsed = emailSignInVerifySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  if (!auth0) return notConfigured;

  const { email, code } = parsed.data;
  const limit = await checkLimits([
    { name: "email-verify-ip", identifier: await clientIpIdentifier(), tokens: 20, window: "10 m" },
    {
      name: "email-verify-address",
      identifier: `email:${hmacIdentifier(email)}`,
      tokens: 10,
      window: "10 m",
    },
  ]);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds, limit.unavailable);

  try {
    await auth0.passwordless.verify({ connection: "email", email, verificationCode: code });
    return { ok: true, data: undefined };
  } catch (error) {
    const errorCode = error instanceof PasswordlessVerifyError ? error.code : "unexpected_error";
    logFailure("verify", errorCode);
    if (errorCode === "invalid_grant") {
      return {
        ok: false,
        code: errorCode,
        fieldErrors: { code: ["That code didn't work. Check it, or send a new code."] },
      };
    }
    if (errorCode === "too_many_attempts") {
      return {
        ok: false,
        code: errorCode,
        formError: "Too many attempts. Send a new code to try again.",
      };
    }
    return { ok: false, code: "unavailable", formError: UNAVAILABLE };
  }
}
