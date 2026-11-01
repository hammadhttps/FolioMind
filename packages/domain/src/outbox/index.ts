import { EVENT_SCHEMAS, type EventData, type EventName } from "@foliomind/contracts";
import { outboxEvents, type Database, type Executor } from "@foliomind/db";
import { eq, inArray, sql } from "drizzle-orm";

/*
 * Transactional outbox (blueprint Sections 3 and 9). A long operation writes
 * its job row and its outbox event in one transaction; after commit the server
 * delivers the event to Inngest with the outbox key as the event ID, and the
 * one-minute dispatcher cron (Phase 6) re-sends anything still undelivered.
 * Duplicate delivery is harmless: Inngest drops repeated event IDs.
 */

export interface OutboxEvent<TName extends EventName = EventName> {
  /** Stable, unique key; becomes the Inngest event ID. */
  key: string;
  name: TName;
  data: EventData<TName>;
}

/** Validates the payload and writes the row inside the caller's transaction. */
export async function enqueue<TName extends EventName>(
  tx: Executor,
  event: OutboxEvent<TName>,
  { availableAt }: { availableAt?: Date } = {},
): Promise<void> {
  const payload = EVENT_SCHEMAS[event.name].parse(event.data);
  await tx
    .insert(outboxEvents)
    .values({
      eventKey: event.key,
      topic: event.name,
      payload,
      ...(availableAt ? { availableAt } : {}),
    })
    // The same operation enqueued twice is one event.
    .onConflictDoNothing({ target: outboxEvents.eventKey });
}

/** Inngest-compatible sender: `inngest.send(events)`. */
export type SendEvents = (
  events: { id: string; name: string; data: Record<string, unknown> }[],
) => Promise<unknown>;

export interface DeliverOptions {
  /** Deliver only these keys (right after the enqueuing transaction commits). */
  keys?: readonly string[];
  limit?: number;
  /** How long a dispatcher owns leased rows before another may retry them. */
  leaseMs?: number;
  /**
   * Overrides the database clock (tests). By default "now" is Postgres's own
   * clock, which a just-committed row's `available_at` can never be ahead of;
   * the application's millisecond clock can trail its microseconds.
   */
  now?: Date;
}

export interface DeliverResult {
  delivered: number;
  failed: number;
}

const DEFAULT_LEASE_MS = 60_000;

/** Retry delay after a failed send: 30 s, doubling, capped at 15 minutes. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Leases due, undelivered rows (skipping rows another dispatcher holds), sends
 * them in one batch and marks them delivered, or schedules a retry on failure.
 */
export async function deliverPending(
  db: Database,
  send: SendEvents,
  { keys, limit = 100, leaseMs = DEFAULT_LEASE_MS, now }: DeliverOptions = {},
): Promise<DeliverResult> {
  if (keys && keys.length === 0) return { delivered: 0, failed: 0 };
  // Raw SQL parameters go to postgres.js as-is, so a supplied time is an ISO string.
  const at = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;
  const keyFilter = keys
    ? sql`and event_key in (${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})`
    : sql``;

  const leased = await db.execute<{
    id: string;
    event_key: string;
    topic: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(sql`
    update ${outboxEvents}
    set lease_until = ${at} + ${leaseMs} * interval '1 millisecond',
        attempts = attempts + 1,
        updated_at = now()
    where id in (
      select id from ${outboxEvents}
      where delivered_at is null
        and available_at <= ${at}
        and (lease_until is null or lease_until < ${at})
        ${keyFilter}
      order by available_at
      limit ${limit}
      for update skip locked
    )
    returning id, event_key, topic, payload, attempts`);
  if (leased.length === 0) return { delivered: 0, failed: 0 };

  const ids = leased.map((row) => row.id);
  try {
    await send(leased.map((row) => ({ id: row.event_key, name: row.topic, data: row.payload })));
  } catch {
    // Back off by attempt count; the lease is cleared so the next due sweep retries.
    for (const row of leased) {
      await db
        .update(outboxEvents)
        .set({
          leaseUntil: null,
          availableAt: sql`${at} + ${outboxBackoffMs(row.attempts)} * interval '1 millisecond'`,
        })
        .where(eq(outboxEvents.id, row.id));
    }
    return { delivered: 0, failed: leased.length };
  }

  await db
    .update(outboxEvents)
    .set({ deliveredAt: sql`${at}`, leaseUntil: null })
    .where(inArray(outboxEvents.id, ids));
  return { delivered: leased.length, failed: 0 };
}
