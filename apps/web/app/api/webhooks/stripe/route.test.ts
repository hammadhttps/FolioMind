// @vitest-environment node
import { createStripe } from "@foliomind/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Stripe webhook route (Section 10 "Webhook endpoint and durability";
 * acceptance: "Missing or forged webhook signatures never grant access"). The
 * signature check is Stripe's real verifier; only persistence is replaced, so
 * these tests show what reaches the database and what never does.
 */

const SECRET = "whsec_route_test_secret";

const mocks = vi.hoisted(() => ({
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_route_test_secret" as string | undefined,
    STRIPE_SECRET_KEY: "sk_test_route" as string | undefined,
  },
  recordStripeEvent: vi.fn(),
  deliverNow: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/outbox", () => ({ deliverNow: mocks.deliverNow }));
vi.mock("@/lib/clients", async () => {
  const domain = await import("@foliomind/domain");
  const stripe = domain.createStripe("sk_test_route");
  return { getDb: () => ({}), getStripe: () => stripe };
});
vi.mock("@foliomind/domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@foliomind/domain")>()),
  recordStripeEvent: mocks.recordStripeEvent,
}));

const { POST } = await import("./route");

const stripe = createStripe("sk_test_route");

function eventBody(type = "customer.subscription.updated", id = "evt_route_1") {
  return JSON.stringify({
    id,
    object: "event",
    type,
    created: 1_800_000_000,
    livemode: false,
    api_version: "2026-09-30.endive",
    data: { object: { id: "sub_route", object: "subscription", customer: "cus_route" } },
  });
}

async function request(
  body: string,
  options: { secret?: string; timestamp?: number; signature?: string | null } = {},
) {
  const signature =
    options.signature === undefined
      ? await stripe.webhooks.generateTestHeaderStringAsync({
          payload: body,
          secret: options.secret ?? SECRET,
          ...(options.timestamp ? { timestamp: options.timestamp } : {}),
        })
      : options.signature;
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set("stripe-signature", signature);
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", body, headers });
}

beforeEach(() => {
  mocks.env.STRIPE_WEBHOOK_SECRET = SECRET;
  mocks.env.STRIPE_SECRET_KEY = "sk_test_route";
  mocks.recordStripeEvent.mockReset();
  mocks.deliverNow.mockReset();
  mocks.recordStripeEvent.mockResolvedValue({
    recorded: true,
    eventKey: "stripe-event:evt_route_1",
  });
  mocks.deliverNow.mockResolvedValue(undefined);
});

describe("POST /api/webhooks/stripe", () => {
  it("refuses a missing signature with 400 and records nothing", async () => {
    const response = await POST(await request(eventBody(), { signature: null }));
    expect(response.status).toBe(400);
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("refuses a signature made with another secret", async () => {
    const response = await POST(await request(eventBody(), { secret: "whsec_someone_else" }));
    expect(response.status).toBe(400);
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("refuses a body changed after signing", async () => {
    const body = eventBody();
    const signed = await request(body);
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: body.replace("cus_route", "cus_attacker"),
    });
    const response = await POST(tampered);
    expect(response.status).toBe(400);
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("refuses a replay outside Stripe's tolerance window", async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const response = await POST(await request(eventBody(), { timestamp: oneHourAgo }));
    expect(response.status).toBe(400);
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("refuses a garbage signature header", async () => {
    const response = await POST(await request(eventBody(), { signature: "t=1,v1=deadbeef" }));
    expect(response.status).toBe(400);
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("records a verified event with only the minimized fields, then delivers it", async () => {
    const response = await POST(await request(eventBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
    expect(mocks.recordStripeEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordStripeEvent.mock.calls[0]?.[1]).toEqual({
      id: "evt_route_1",
      type: "customer.subscription.updated",
      created: 1_800_000_000,
      livemode: false,
      objectId: "sub_route",
      customerId: "cus_route",
    });
    expect(mocks.deliverNow).toHaveBeenCalledWith(["stripe-event:evt_route_1"]);
  });

  it("answers a duplicate delivery with 2xx and sends nothing new", async () => {
    mocks.recordStripeEvent.mockResolvedValue({ recorded: false, eventKey: null });
    const response = await POST(await request(eventBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.deliverNow).not.toHaveBeenCalled();
  });

  it("returns a retryable 503 when the event can't be stored", async () => {
    mocks.recordStripeEvent.mockRejectedValue(new Error("connection refused"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(await request(eventBody()));
    spy.mockRestore();
    expect(response.status).toBe(503);
    expect(mocks.deliverNow).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores event types FolioMind doesn't handle", async () => {
    const response = await POST(await request(eventBody("customer.created")));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("returns 503 while billing isn't configured, before reading the body", async () => {
    mocks.env.STRIPE_WEBHOOK_SECRET = undefined;
    const response = await POST(await request(eventBody()));
    expect(response.status).toBe(503);
    expect(mocks.recordStripeEvent).not.toHaveBeenCalled();
  });
});
