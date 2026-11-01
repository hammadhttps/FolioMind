/*
 * Shared shapes for forms and the Server Actions that parse their input again
 * (blueprint Section 28). Form schemas are added here as features need them.
 */

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
