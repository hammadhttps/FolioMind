import {
  ProviderError,
  providerErrorFromResponse,
  providerNetworkError,
} from "@foliomind/contracts";
import { z } from "zod";

const BASE_URL = "https://api.pushengage.com/apiv1";
const PROVIDER = "PushEngage";

export interface PushEngageConfig {
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface SendPushInput {
  /** At most 85 characters. */
  title: string;
  /** At most 135 characters; never private document text (Section 7). */
  message: string;
  url: string;
  /** PushEngage subscriber hashes, 1–100 per request. */
  subscriberHashes: readonly string[];
  imageUrl?: string;
}

const sendResponse = z.object({
  success: z.boolean(),
  notification_id: z.number().optional(),
  message: z.string().optional(),
});

const listResponse = z.object({
  success: z.boolean(),
  count: z.number().optional(),
  message: z.string().optional(),
});

/**
 * Minimal PushEngage REST client (form-encoded requests, `Api-Key` header).
 * The browser SDK and device registration arrive in Phase 6.
 */
export function createPushEngage(config: PushEngageConfig) {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  async function request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { "Api-Key": config.apiKey, Accept: "application/json", ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw providerNetworkError(PROVIDER, error);
    }
    if (!response.ok) throw await providerErrorFromResponse(PROVIDER, response);
    return response.json();
  }

  return {
    async send(input: SendPushInput): Promise<{ notificationId: number }> {
      if (input.title.length > 85 || input.message.length > 135) {
        throw new ProviderError(PROVIDER, "title or message exceeds PushEngage limits", {
          retryable: false,
        });
      }
      if (input.subscriberHashes.length < 1 || input.subscriberHashes.length > 100) {
        throw new ProviderError(PROVIDER, "send to between 1 and 100 subscribers per request", {
          retryable: false,
        });
      }
      const form = new URLSearchParams({
        notification_title: input.title,
        notification_message: input.message,
        notification_url: input.url,
      });
      if (input.imageUrl) form.set("image_url", input.imageUrl);
      // Array field encoding for form bodies; confirm against a real site in Phase 6.
      for (const hash of input.subscriberHashes) form.append("subscriber_hash[]", hash);

      const body = sendResponse.parse(
        await request("/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        }),
      );
      if (!body.success || body.notification_id === undefined) {
        throw new ProviderError(PROVIDER, body.message ?? "send was not accepted", {
          retryable: false,
        });
      }
      return { notificationId: body.notification_id };
    },

    /** Read-only call used by the connectivity check. */
    async listNotifications(limit = 1): Promise<{ count: number }> {
      const body = listResponse.parse(
        await request(`/notifications?limit=${limit}`, { method: "GET" }),
      );
      if (!body.success) {
        throw new ProviderError(PROVIDER, body.message ?? "request was not accepted", {
          retryable: false,
        });
      }
      return { count: body.count ?? 0 };
    },
  };
}

export type PushEngageClient = ReturnType<typeof createPushEngage>;
