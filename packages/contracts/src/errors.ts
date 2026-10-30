/**
 * Error raised by provider clients (blueprint Section 8 "Provider integration
 * notes"): 408/429/5xx and network failures are retryable, other 4xx are not.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    provider: string,
    message: string,
    options: { status?: number; retryable: boolean; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Builds a ProviderError from a non-OK HTTP response without echoing secrets. */
export async function providerErrorFromResponse(
  provider: string,
  response: Response,
): Promise<ProviderError> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    // The body is diagnostic only.
  }
  return new ProviderError(
    provider,
    `${provider} request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    {
      status: response.status,
      retryable: isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    },
  );
}

/** Wraps fetch failures (DNS, connection reset, timeout) as retryable provider errors. */
export function providerNetworkError(provider: string, cause: unknown): ProviderError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new ProviderError(provider, `${provider} request failed: ${reason}`, {
    retryable: true,
    cause,
  });
}

/** Thrown when code needs a service whose variables are not set (development only). */
export class ServiceNotConfiguredError extends Error {
  readonly service: string;
  readonly missing: readonly string[];

  constructor(service: string, missing: readonly string[]) {
    super(`${service} is not configured: set ${missing.join(", ")}`);
    this.name = "ServiceNotConfiguredError";
    this.service = service;
    this.missing = missing;
  }
}
