import { z } from "zod";

/*
 * Form schemas shared by React Hook Form on the client and the Server Actions
 * that parse the same input again (blueprint Section 28).
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.email({ error: "Enter a valid email address." }).max(254, "Enter a shorter email address."),
  );

/** Step 1 of email sign-in: send a one-time code to this address. */
export const emailSignInStartSchema = z.object({ email });

/** Step 2 of email sign-in: the 6-digit code from the email. */
export const emailSignInVerifySchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
});

export type EmailSignInStartInput = z.input<typeof emailSignInStartSchema>;
export type EmailSignInVerifyInput = z.input<typeof emailSignInVerifySchema>;

/** Server Action result shape (blueprint Section 6 conventions). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      formError?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      retryAfterSeconds?: number;
    };
