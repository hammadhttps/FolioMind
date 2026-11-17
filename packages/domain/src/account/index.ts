import { users, type Database, type Executor } from "@foliomind/db";
import { eq, sql } from "drizzle-orm";
import { writeAudit } from "../audit";

/*
 * Account deletion (blueprint Section 6 "Subscription and account end
 * states"; retention in docs/policies/data-retention.md). One transaction marks
 * the account `deleting` (every request and sign-in then refuses it), revokes
 * access to its documents, projects and books, removes personal data that has
 * no retention purpose, cancels live jobs and queues every stored file for
 * deletion. Stripe cancellation and the Auth0 identity are removed right
 * after, and the daily cleanup retries whatever didn't finish, then anonymizes
 * the row that billing and audit records still point to.
 */

export type DeletionOutcome =
  | {
      ok: true;
      auth0Sub: string;
      /** Stripe subscriptions to cancel now; billing must never renew after deletion. */
      subscriptionIds: string[];
      /** Stored files to remove from UploadThing. */
      fileKeys: string[];
      /** Catalog entries that left the library, for cache invalidation. */
      publisherSlugs: string[];
      bookIds: string[];
    }
  | { ok: false; code: "not_found" | "already_deleting" | "admin_account" };

export async function requestAccountDeletion(
  db: Database,
  input: { userId: string },
): Promise<DeletionOutcome> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, status: users.status, role: users.role, auth0Sub: users.auth0Sub })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user) return { ok: false, code: "not_found" } as const;
    if (user.status === "deleting") return { ok: false, code: "already_deleting" } as const;
    // Admin is granted and removed only through the audited process (Section 4).
    if (user.role === "admin") return { ok: false, code: "admin_account" } as const;
    const id = user.id;

    await tx.execute(
      sql`update users set status = 'deleting', updated_at = now() where id = ${id}`,
    );

    // Revoke access at once: every read checks these statuses.
    await tx.execute(sql`
      update documents set status = 'deleting', deleted_at = now(), updated_at = now()
      where owner_id = ${id} and status = 'active'`);
    await tx.execute(sql`
      update projects set deleted_at = now(), updated_at = now()
      where owner_id = ${id} and deleted_at is null`);
    await tx.execute(sql`
      update jobs set cancel_requested = true, status = 'cancelled', safe_error_code = 'cancelled',
        updated_at = now()
      where owner_id = ${id} and status in ('queued', 'running')`);
    await tx.execute(sql`
      update upload_intents set status = 'expired' where user_id = ${id} and status = 'issued'`);

    // A publisher's books leave the catalog with the profile.
    const books = await tx.execute<{ id: string; slug: string }>(sql`
      update books b set status = 'unpublished', updated_at = now()
      from publisher_profiles p
      where p.id = b.publisher_id and p.user_id = ${id} and b.status = 'published'
      returning b.id, p.slug`);
    await tx.execute(sql`
      update book_revisions br set status = 'draft', updated_at = now()
      from books b join publisher_profiles p on p.id = b.publisher_id
      where br.book_id = b.id and p.user_id = ${id} and br.status = 'pending'`);
    const profiles = await tx.execute<{ slug: string }>(sql`
      update publisher_profiles set status = 'suspended', updated_at = now()
      where user_id = ${id} and status <> 'suspended'
      returning slug`);

    // Personal data with no retention purpose goes now.
    await tx.execute(sql`delete from library_items where user_id = ${id}`);
    await tx.execute(sql`delete from collections where user_id = ${id}`);
    await tx.execute(sql`delete from annotations where user_id = ${id}`);
    await tx.execute(sql`delete from reading_progress where user_id = ${id}`);
    await tx.execute(sql`delete from conversations where user_id = ${id}`);
    await tx.execute(sql`delete from workspaces where owner_id = ${id}`);
    await tx.execute(sql`delete from publisher_follows where user_id = ${id}`);
    await tx.execute(sql`delete from notifications where user_id = ${id}`);
    await tx.execute(sql`delete from push_devices where user_id = ${id}`);

    // Every stored file (sources, exports, covers, avatar) is queued for removal.
    const files = await tx.execute<{ file_key: string }>(sql`
      update assets set state = 'deleting', updated_at = now()
      where owner_id = ${id} and state in ('pending', 'ready')
      returning file_key`);

    const live = await tx.execute<{ stripe_subscription_id: string }>(sql`
      select stripe_subscription_id from subscriptions
      where user_id = ${id} and status not in ('canceled', 'incomplete_expired')`);

    await writeAudit(tx, {
      actorId: id,
      action: "user.deletion_requested",
      targetType: "user",
      targetId: id,
      metadata: {
        files: files.length,
        subscriptions: live.length,
        booksUnpublished: books.length,
      },
    });
    return {
      ok: true,
      auth0Sub: user.auth0Sub,
      subscriptionIds: live.map((row) => row.stripe_subscription_id),
      fileKeys: files.map((row) => row.file_key),
      publisherSlugs: [
        ...new Set([...profiles.map((row) => row.slug), ...books.map((row) => row.slug)]),
      ],
      bookIds: books.map((row) => row.id),
    } as const;
  });
}

/** The Auth0 identity is gone: the sub no longer names anyone, so it's replaced. */
export async function markIdentityDeleted(db: Executor, userId: string): Promise<void> {
  await db.execute(sql`
    update users set auth0_sub = ${`deleted|${userId}`}, updated_at = now()
    where id = ${userId} and status = 'deleting' and auth0_sub not like 'deleted|%'`);
  await writeAudit(db, {
    actorId: null,
    action: "user.identity_deleted",
    targetType: "user",
    targetId: userId,
    metadata: {},
  });
}

export interface PendingDeletion {
  userId: string;
  auth0Sub: string | null;
  subscriptionIds: string[];
}

/** Deleting accounts with an external step left: an Auth0 identity or a live subscription. */
export async function deletionsToFinish(
  db: Executor,
  { limit = 20 }: { limit?: number } = {},
): Promise<PendingDeletion[]> {
  const rows = await db.execute<{
    id: string;
    auth0_sub: string;
    subscription_ids: string[];
  }>(sql`
    select u.id, u.auth0_sub,
      coalesce((select json_agg(s.stripe_subscription_id) from subscriptions s
        where s.user_id = u.id and s.status not in ('canceled', 'incomplete_expired')), '[]'::json)
        as subscription_ids
    from users u
    where u.status = 'deleting' and u.deleted_at is null
      and (u.auth0_sub not like 'deleted|%' or exists (
        select 1 from subscriptions s where s.user_id = u.id
          and s.status not in ('canceled', 'incomplete_expired')))
    order by u.updated_at
    limit ${limit}`);
  return rows.map((row) => ({
    userId: row.id,
    auth0Sub: row.auth0_sub.startsWith("deleted|") ? null : row.auth0_sub,
    subscriptionIds: row.subscription_ids,
  }));
}

/** Marks a subscription cancelled locally once Stripe confirmed it (the sync will agree). */
export async function markSubscriptionCancelled(db: Executor, stripeSubscriptionId: string) {
  await db.execute(sql`
    update subscriptions set status = 'canceled', cancel_at_period_end = false, updated_at = now()
    where stripe_subscription_id = ${stripeSubscriptionId}`);
}

/**
 * Final step, once the identity is deleted, no subscription is live and every
 * stored file is gone: the row is anonymized and kept only for the billing and
 * audit records that reference it (docs/policies/data-retention.md).
 */
export async function anonymizeDeletedAccounts(
  db: Executor,
  { limit = 50 }: { limit?: number } = {},
): Promise<number> {
  const done = await db.execute<{ id: string }>(sql`
    update users u set
      email = 'deleted-' || u.id || '@deleted.invalid',
      email_verified = false,
      display_name = 'Deleted account',
      avatar_url = null,
      avatar_asset_id = null,
      deleted_at = now(),
      updated_at = now()
    where u.id in (
      select id from users
      where status = 'deleting' and deleted_at is null and auth0_sub like 'deleted|%'
        and not exists (select 1 from subscriptions s where s.user_id = users.id
          and s.status not in ('canceled', 'incomplete_expired'))
        and not exists (select 1 from assets a where a.owner_id = users.id
          and a.state in ('pending', 'ready', 'deleting'))
      limit ${limit})
    returning u.id`);
  for (const row of done) {
    await db.execute(sql`delete from user_identities where user_id = ${row.id}`);
    await db.execute(sql`delete from user_preferences where user_id = ${row.id}`);
    await writeAudit(db, {
      actorId: null,
      action: "user.deleted",
      targetType: "user",
      targetId: row.id,
      metadata: {},
    });
  }
  return done.length;
}
