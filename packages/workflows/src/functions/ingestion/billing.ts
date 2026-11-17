import {
  customersToReconcile,
  invalidateUserSnapshot,
  isWebhookEventProcessed,
  markCustomerEventsProcessed,
  markWebhookEvent,
  noticeEvents,
  noticesForEvent,
  staleCheckoutSessions,
  syncCheckoutSession,
  syncCustomer,
} from "@foliomind/domain";
import { cron, NonRetriableError, type Inngest } from "inngest";
import { billingStripeWebhookRecorded } from "../../events";
import { controlConcurrency, type WorkerADeps } from "./shared";

/*
 * Billing synchronization in Worker A (blueprint Sections 9 and 10).
 * `sync-stripe` handles one recorded webhook: it fetches the customer's
 * current Stripe objects and rebuilds the snapshot, one customer at a time by
 * its concurrency key, so late or repeated events can't overwrite newer
 * state. `reconcile-billing` sweeps what events may have missed.
 */

function requireBilling(deps: WorkerADeps) {
  if (!deps.billing) throw new NonRetriableError("Stripe isn't configured for this worker");
  return deps.billing;
}

async function dropSnapshot(deps: WorkerADeps, userId: string) {
  if (deps.cache) await invalidateUserSnapshot(deps.cache.redis, deps.cache.keys, userId);
}

export function createSyncStripeFunction(inngest: Inngest, deps: WorkerADeps) {
  const { db } = deps;
  return inngest.createFunction(
    {
      id: "sync-stripe",
      name: "Sync Stripe",
      triggers: [billingStripeWebhookRecorded],
      retries: 3,
      idempotency: "event.data.operationKey",
      // Section 9: per-customer key limit 1, inside the shared control limit.
      concurrency: [
        { limit: 1, key: "event.data.customerId" },
        controlConcurrency(deps.concurrency.control),
      ],
      onFailure: async ({ event }) => {
        // Left for reconcile-billing, which re-syncs the customer.
        await markWebhookEvent(db, event.data.event.data.eventId, {
          status: "failed",
          errorCode: "sync_failed",
        });
      },
    },
    async ({ event, step }) => {
      const billing = requireBilling(deps);
      const { eventId, eventType, objectId } = event.data;
      if (await step.run("check-processed", () => isWebhookEventProcessed(db, eventId))) {
        return { skipped: "already processed" };
      }

      let customerId = event.data.customerId;
      if (eventType.startsWith("checkout.session.") && objectId) {
        const sessionCustomer = await step.run("checkout-session", async () => {
          const session = await billing.gateway.retrieveCheckoutSession(objectId);
          await syncCheckoutSession(db, session, {
            asyncPaymentFailed: eventType === "checkout.session.async_payment_failed",
          });
          return session.customerId;
        });
        customerId ??= sessionCustomer;
      }
      if (!customerId) {
        await step.run("mark-ignored", () => markWebhookEvent(db, eventId, { status: "ignored" }));
        return { skipped: "no customer" };
      }

      const result = await step.run("sync-customer", () =>
        syncCustomer(db, billing.gateway, { customerId, proPriceId: billing.proPriceId }),
      );
      if (result.userId) {
        const userId = result.userId;
        const notices = await step.run("notices", () =>
          noticesForEvent(db, { userId, eventType, objectId }),
        );
        if (notices.length > 0) await step.sendEvent("notify", noticeEvents(notices));
        if (result.planChanged) await step.run("drop-snapshot", () => dropSnapshot(deps, userId));
      }
      await step.run("mark-processed", () =>
        markWebhookEvent(db, eventId, { status: result.userId ? "processed" : "ignored" }),
      );
      deps.logger.info(
        { eventType, planCode: result.planCode, planChanged: result.planChanged },
        "stripe synced",
      );
      return { planCode: result.planCode, planChanged: result.planChanged };
    },
  );
}

/** Hourly in production (Section 9), at the outbox sweep's minute so Neon wakes once. */
export function createReconcileBillingFunction(inngest: Inngest, deps: WorkerADeps) {
  const { db } = deps;
  return inngest.createFunction(
    {
      id: "reconcile-billing",
      name: "Reconcile billing",
      triggers: [cron(deps.billingCron)],
      retries: 3,
      concurrency: [{ limit: 1 }, controlConcurrency(deps.concurrency.control)],
    },
    async ({ step }) => {
      if (!deps.billing) return { skipped: "not configured" };
      const billing = deps.billing;
      const settled = await step.run("settle-checkout-sessions", async () => {
        const customers: string[] = [];
        for (const sessionId of await staleCheckoutSessions(db, { limit: 20 })) {
          const session = await billing.gateway.retrieveCheckoutSession(sessionId);
          await syncCheckoutSession(db, session);
          if (session.customerId) customers.push(session.customerId);
        }
        return customers;
      });
      const stale = await step.run("find-stale", () => customersToReconcile(db, { limit: 20 }));
      const customers = [...new Set([...settled, ...stale])].slice(0, 20);
      let changed = 0;
      for (const customerId of customers) {
        const result = await step.run(`sync-${customerId}`, async () => {
          const outcome = await syncCustomer(db, billing.gateway, {
            customerId,
            proPriceId: billing.proPriceId,
          });
          // Whatever this customer's unfinished events were about is now in sync.
          await markCustomerEventsProcessed(db, customerId);
          if (outcome.userId && outcome.planChanged) await dropSnapshot(deps, outcome.userId);
          return outcome.planChanged;
        });
        if (result) changed += 1;
      }
      if (customers.length > 0)
        deps.logger.info({ customers: customers.length, changed }, "billing reconciled");
      return { customers: customers.length, changed };
    },
  );
}
