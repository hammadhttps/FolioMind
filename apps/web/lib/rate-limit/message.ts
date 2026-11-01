/* Shared by the server responses and the client toast; no Node-only imports. */

/** Section 23 toast copy, e.g. "You're going a little fast. Try again in 20 seconds." */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const wait =
    retryAfterSeconds < 60
      ? `${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`
      : `${Math.ceil(retryAfterSeconds / 60)} minute${Math.ceil(retryAfterSeconds / 60) === 1 ? "" : "s"}`;
  return `You're going a little fast. Try again in ${wait}.`;
}
