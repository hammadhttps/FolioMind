import { randomUUID } from "node:crypto";
import {
  EVENT_NAMES,
  type ApplicationDecisionInput,
  type PublisherApplicationValues,
  type PublisherProfileInput,
  type PublisherStatus,
} from "@foliomind/contracts";
import { publisherProfiles, users, type Database, type Executor } from "@foliomind/db";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Actor } from "../access";
import { writeAudit } from "../audit";
import { enqueue } from "../outbox";
import { keysetPage, keysetPlan, likePattern, type KeysetPage } from "../keyset";
import {
  approvedPublisherFor,
  getPublisherProfileForUser,
  hasPublishedBook,
  type PublisherProfileRecord,
} from "./records";

/*
 * Publisher applications and profiles (blueprint Sections 4, 6 and 28). A
 * reader with a verified email applies; an admin approves (granting the
 * `publisher` role) or rejects with a reason. Publishers do not receive Pro.
 */

class Refused<T extends string> extends Error {
  constructor(readonly code: T) {
    super(code);
  }
}

const isUniqueViolation = (error: unknown, constraint: string) => {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: string }).code === "23505" &&
    String((cause as { constraint_name?: string }).constraint_name ?? "").includes(constraint)
  );
};

export type ApplyOutcome =
  | { ok: true; profileId: string }
  | {
      ok: false;
      code:
        | "account_inactive"
        | "email_unverified"
        | "admin_account"
        | "already_applied"
        | "already_publisher"
        | "slug_taken"
        | "not_publisher";
    };

/** Section 28 "Publisher application"; a rejected applicant may apply again. */
export async function applyToPublish(
  db: Database,
  actor: Actor,
  input: PublisherApplicationValues,
): Promise<ApplyOutcome> {
  type Code = Extract<ApplyOutcome, { ok: false }>["code"];
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          role: users.role,
          status: users.status,
          emailVerified: users.emailVerified,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(eq(users.id, actor.id))
        .for("update");
      if (!user || user.status !== "active" || user.deletedAt) {
        throw new Refused<Code>("account_inactive");
      }
      // Section 22 rule 2: unverified addresses can't apply to publish.
      if (!user.emailVerified) throw new Refused<Code>("email_unverified");
      if (user.role === "admin") throw new Refused<Code>("admin_account");
      if (user.role === "publisher") throw new Refused<Code>("already_publisher");

      const [taken] = await tx
        .select({ id: publisherProfiles.id })
        .from(publisherProfiles)
        .where(and(eq(publisherProfiles.slug, input.slug), ne(publisherProfiles.userId, actor.id)));
      if (taken) throw new Refused<Code>("slug_taken");

      const existing = await getPublisherProfileForUser(tx, actor.id);
      let profileId: string;
      if (existing) {
        if (existing.status === "applicant") throw new Refused<Code>("already_applied");
        if (existing.status === "approved") throw new Refused<Code>("already_publisher");
        if (existing.status === "suspended") throw new Refused<Code>("not_publisher");
        await tx
          .update(publisherProfiles)
          .set({
            slug: input.slug,
            displayName: input.displayName,
            bio: input.bio,
            website: input.website ?? null,
            status: "applicant",
            reviewedBy: null,
            reviewReason: null,
            updatedAt: sql`now()`,
          })
          .where(eq(publisherProfiles.id, existing.id));
        profileId = existing.id;
      } else {
        const [created] = await tx
          .insert(publisherProfiles)
          .values({
            userId: actor.id,
            slug: input.slug,
            displayName: input.displayName,
            bio: input.bio,
            website: input.website ?? null,
            status: "applicant",
          })
          .returning({ id: publisherProfiles.id });
        if (!created) throw new Error("Publisher application was not saved");
        profileId = created.id;
      }
      await writeAudit(tx, {
        actorId: actor.id,
        action: "publisher.applied",
        targetType: "publisher_profile",
        targetId: profileId,
        metadata: { slug: input.slug, reapplied: Boolean(existing), rightsConfirmed: true },
      });
      return { ok: true, profileId } as const;
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, code: error.code as Code };
    if (isUniqueViolation(error, "slug")) return { ok: false, code: "slug_taken" };
    throw error;
  }
}

export type ApplicationReviewOutcome =
  | {
      ok: true;
      /** The applicant, whose cached snapshot must be dropped (role changed). */
      userId: string;
      eventKeys: string[];
    }
  | { ok: false; code: "not_found" | "already_decided" };

/**
 * Admin decision on an application (Section 4): approval grants the publisher
 * role and approves the profile; rejection keeps the reason for the applicant.
 * Both are audited and the applicant is notified.
 */
export async function reviewPublisherApplication(
  db: Database,
  admin: Actor,
  input: {
    profileId: string;
    action: ApplicationDecisionInput["action"];
    reason?: string | undefined;
  },
): Promise<ApplicationReviewOutcome> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        id: publisherProfiles.id,
        userId: publisherProfiles.userId,
        status: publisherProfiles.status,
        slug: publisherProfiles.slug,
      })
      .from(publisherProfiles)
      .where(eq(publisherProfiles.id, input.profileId))
      .for("update");
    if (!profile) return { ok: false, code: "not_found" } as const;
    if (profile.status !== "applicant") return { ok: false, code: "already_decided" } as const;

    const approve = input.action === "approve";
    await tx
      .update(publisherProfiles)
      .set({
        status: approve ? "approved" : "rejected",
        reviewedBy: admin.id,
        reviewReason: input.reason ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(publisherProfiles.id, profile.id));
    await writeAudit(tx, {
      actorId: admin.id,
      action: approve ? "publisher.approved" : "publisher.rejected",
      targetType: "publisher_profile",
      targetId: profile.id,
      metadata: { userId: profile.userId, slug: profile.slug },
    });

    if (approve) {
      // Only a reader becomes a publisher; an admin's role is never lowered here.
      const granted = await tx
        .update(users)
        .set({ role: "publisher", updatedAt: sql`now()` })
        .where(and(eq(users.id, profile.userId), eq(users.role, "reader")))
        .returning({ id: users.id });
      if (granted.length > 0) {
        await writeAudit(tx, {
          actorId: admin.id,
          action: "user.role_granted",
          targetType: "user",
          targetId: profile.userId,
          metadata: { role: "publisher", via: "publisher_application" },
        });
      }
    }

    const eventKey = `publisher-review:${profile.id}:${randomUUID()}`;
    await enqueue(tx, {
      key: eventKey,
      name: EVENT_NAMES.notificationCreated,
      data: {
        userId: profile.userId,
        type: approve ? "publisher_approved" : "publisher_rejected",
        subjectId: profile.id,
        operationKey: eventKey,
      },
    });
    return { ok: true, userId: profile.userId, eventKeys: [eventKey] } as const;
  });
}

export interface ApplicationRow {
  id: string;
  userId: string;
  email: string;
  slug: string;
  displayName: string;
  bio: string;
  website: string | null;
  status: PublisherStatus;
  reviewReason: string | null;
  updatedAt: Date;
}

/** Admin applications tab: waiting applications, oldest first (keyset). */
export async function listPublisherApplications(
  db: Executor,
  query: {
    status: "applicant" | "decided";
    q?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
  },
): Promise<KeysetPage<ApplicationRow>> {
  const waiting = query.status === "applicant";
  const plan = keysetPlan({
    sortKey: sql`p.updated_at`,
    idColumn: sql`p.id`,
    ascending: waiting,
    valueType: "timestamptz",
    after: query.after,
    before: query.before,
    limit: query.limit,
  });
  const filters = [
    waiting ? sql`p.status = 'applicant'` : sql`p.status in ('approved', 'rejected')`,
  ];
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      sql`(p.display_name ilike ${pattern} or p.slug ilike ${pattern} or u.email ilike ${pattern})`,
    );
  }
  if (plan.filter) filters.push(plan.filter);
  const rows = await db.execute<{
    id: string;
    user_id: string;
    email: string;
    slug: string;
    display_name: string;
    bio: string;
    website: string | null;
    status: PublisherStatus;
    review_reason: string | null;
    updated_at: string;
    sort_value: string;
  }>(sql`
    select p.id, p.user_id, u.email, p.slug, p.display_name, p.bio, p.website, p.status,
      p.review_reason, p.updated_at, p.updated_at::text as sort_value
    from publisher_profiles p
    join users u on u.id = p.user_id
    where ${sql.join(filters, sql` and `)}
    order by ${plan.orderBy}
    limit ${query.limit + 1}`);
  return keysetPage(rows, plan, query.limit, (row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    slug: row.slug,
    displayName: row.display_name,
    bio: row.bio,
    website: row.website,
    status: row.status,
    reviewReason: row.review_reason,
    updatedAt: new Date(row.updated_at),
  }));
}

export async function pendingApplicationCount(db: Executor): Promise<number> {
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from publisher_profiles where status = 'applicant'`,
  );
  return Number(row?.count ?? 0);
}

/* --- Profile management ---------------------------------------------------- */

export interface PublisherAccount {
  profile: PublisherProfileRecord | null;
  /** True once a book has been approved: the address can no longer change. */
  slugLocked: boolean;
}

export async function getPublisherAccount(db: Executor, userId: string): Promise<PublisherAccount> {
  const profile = await getPublisherProfileForUser(db, userId);
  return {
    profile,
    slugLocked: profile ? await hasPublishedBook(db, profile.id) : false,
  };
}

export type ProfileUpdateOutcome =
  | { ok: true; slugs: string[] }
  | { ok: false; code: "not_publisher" | "slug_taken" | "slug_locked" };

/**
 * Biography, name, website and address. The address (slug) can change only
 * until the first book is approved, so published links never break (decision
 * recorded in PROGRESS.md: no redirect table).
 */
export async function updatePublisherProfile(
  db: Database,
  actor: Actor,
  input: Omit<PublisherProfileInput, "website"> & { website?: string | undefined },
): Promise<ProfileUpdateOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const profile = await approvedPublisherFor(tx, actor, { lock: true });
      if (!profile) return { ok: false, code: "not_publisher" } as const;
      const slug = input.slug.trim().toLowerCase();
      const slugChanged = slug !== profile.slug;
      if (slugChanged) {
        if (await hasPublishedBook(tx, profile.id))
          return { ok: false, code: "slug_locked" } as const;
        const [taken] = await tx
          .select({ id: publisherProfiles.id })
          .from(publisherProfiles)
          .where(and(eq(publisherProfiles.slug, slug), ne(publisherProfiles.id, profile.id)));
        if (taken) return { ok: false, code: "slug_taken" } as const;
      }
      await tx
        .update(publisherProfiles)
        .set({
          displayName: input.displayName.trim(),
          bio: input.bio.trim(),
          website: input.website ?? null,
          slug,
          updatedAt: sql`now()`,
        })
        .where(eq(publisherProfiles.id, profile.id));
      await writeAudit(tx, {
        actorId: actor.id,
        action: "publisher.profile_updated",
        targetType: "publisher_profile",
        targetId: profile.id,
        metadata: { slugChanged },
      });
      return { ok: true, slugs: slugChanged ? [profile.slug, slug] : [slug] } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error, "slug")) return { ok: false, code: "slug_taken" };
    throw error;
  }
}
