import { STRIPE_WEBHOOK_EVENTS } from "@foliomind/contracts";
import { isHandledStripeEvent, recordStripeEvent } from "@foliomind/domain";
import type Stripe from "stripe";
import { env } from "@/env";
import { getDb, getStripe } from "@/lib/clients";
import { deliverNow } from "@/lib/outbox";

import { logEvent } from "@/lib/log";
/*
 * `POST /api/webhooks/stripe` (Section 10 "Webhook endpoint and durability").
 * The untouched raw body is verified against Stripe-Signature before anything
 * is parsed or trusted; a missing or invalid signature is a 400. A verified
 * event is accepted only after its row and outbox event commit together (2xx),
 * a repeat is a 2xx with nothing new, and a database failure is a retryable
 * 5xx. No slow work happens here: Worker A's sync-stripe does it. Exempt from
 * rate limits; the signature is the gate.
 */

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: unknown }).id);
  }
  return null;
}

function customerOf(object: Record<string, unknown>): string | null {
  if (object.object === "customer") return idOf(object.id);
  return idOf(object.customer);
}

export async function POST(request: Request) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !env.STRIPE_SECRET_KEY) {
    return Response.json({ error: { code: "not_configured" } }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: { code: "bad_signature" } }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return Response.json({ error: { code: "bad_signature" } }, { status: 400 });
  }

  if (!isHandledStripeEvent(event.type, STRIPE_WEBHOOK_EVENTS)) {
    return Response.json({ received: true, ignored: true });
  }
  const object = event.data.object as unknown as Record<string, unknown>;
  let recorded: Awaited<ReturnType<typeof recordStripeEvent>>;
  try {
    recorded = await recordStripeEvent(getDb(), {
      id: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      objectId: idOf(object.id),
      customerId: customerOf(object),
    });
  } catch (error) {
    // Not durably accepted: Stripe retries the delivery.
    logEvent("error", "stripe.webhook_persist_failed", { name: (error as Error)?.name });
    return Response.json({ error: { code: "unavailable" } }, { status: 503 });
  }
  if (recorded.eventKey) await deliverNow([recorded.eventKey]);
  return Response.json({ received: true, duplicate: !recorded.recorded });
}
