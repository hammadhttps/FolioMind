import { describe, expect, it } from "vitest";
import { createPushEngage } from "./pushengage";

describe("createPushEngage", () => {
  it("sends form-encoded notifications with the Api-Key header", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), init: init ?? {} };
      return Response.json({ success: true, notification_id: 42 });
    }) as typeof fetch;

    const client = createPushEngage({ apiKey: "pe-key", fetch: fetchImpl });
    const result = await client.send({
      title: "Your PDF is ready to read.",
      message: "Open it in your library.",
      url: "https://foliomind.test/dashboard/library",
      subscriberHashes: ["hash-1", "hash-2"],
    });

    expect(result.notificationId).toBe(42);
    expect(request?.url).toBe("https://api.pushengage.com/apiv1/notifications");
    expect((request?.init.headers as Record<string, string>)["Api-Key"]).toBe("pe-key");
    const body = new URLSearchParams(String(request?.init.body));
    expect(body.get("notification_title")).toBe("Your PDF is ready to read.");
    expect(body.getAll("subscriber_hash[]")).toEqual(["hash-1", "hash-2"]);
  });

  it("refuses titles longer than PushEngage allows before sending", async () => {
    const client = createPushEngage({
      apiKey: "pe-key",
      fetch: (async () => Response.json({ success: true })) as typeof fetch,
    });
    await expect(
      client.send({
        title: "x".repeat(86),
        message: "m",
        url: "https://x.test",
        subscriberHashes: ["h"],
      }),
    ).rejects.toMatchObject({ retryable: false });
  });
});
