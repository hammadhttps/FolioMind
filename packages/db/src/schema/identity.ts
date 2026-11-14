import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { id, timestamps, timestamptz } from "./columns";
import { identityProvider, themePreference, userRole, userStatus } from "./enums";
import { assets } from "./files";

/* Section 12 "Identity and publishing": accounts, sign-in methods and preferences. */

export const users = pgTable(
  "users",
  {
    id: id(),
    /** The primary Auth0 identity; users are upserted by it, never by email (Section 6). */
    auth0Sub: text("auth0_sub").notNull().unique(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: text("display_name").notNull(),
    avatarAssetId: uuid("avatar_asset_id").references((): AnyPgColumn => assets.id, {
      onDelete: "set null",
    }),
    /** Provider picture until a custom avatar is uploaded. */
    avatarUrl: text("avatar_url"),
    role: userRole("role").notNull().default("reader"),
    status: userStatus("status").notNull().default("active"),
    /** An admin suspension's optional end (Section 28 "Suspend user"); null means until lifted. */
    suspendedUntil: timestamptz("suspended_until"),
    deletedAt: timestamptz("deleted_at"),
    ...timestamps(),
  },
  (t) => [
    // Duplicate verified-email detection (Section 22 rule 3) and admin search.
    index("users_email_lower_idx").on(sql`lower(${t.email})`),
    // Admin users list: newest first (Section 24).
    index("users_created_idx").on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  ],
);

/** Mirrors the Auth0 identities linked to a user, for the Sign-in methods panel and audit. */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: identityProvider("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    email: text("email"),
    linkedAt: timestamptz("linked_at").notNull().defaultNow(),
    lastLoginAt: timestamptz("last_login_at"),
    ...timestamps(),
  },
  (t) => [
    unique("user_identities_provider_user_key").on(t.provider, t.providerUserId),
    index("user_identities_user_idx").on(t.userId),
  ],
);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Light is the initial default (Section 15).
  theme: themePreference("theme").notNull().default("light"),
  locale: text("locale").notNull().default("en"),
  notificationSettings: jsonb("notification_settings")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  onboardingCompletedAt: timestamptz("onboarding_completed_at"),
  ...timestamps(),
});
