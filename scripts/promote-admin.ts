/**
 * `pnpm promote-admin <email> [--reason "<why>"]` — grants the admin role to an
 * existing FolioMind account (blueprint Section 4: admin is granted only
 * through an audited privileged process). The role change and its audit entry
 * commit in one transaction, and the user's cached snapshot is dropped so the
 * change applies on their next request.
 *
 * Runs as the migration role over DIRECT_DATABASE_URL (the local Compose
 * database when unset). Upstash variables are optional; without them the cached
 * snapshot simply expires within 60 seconds.
 */
import { resolveAppEnv } from "@foliomind/contracts";
import { createDb } from "@foliomind/db";
import { describeDatabaseUrl, migrationDatabaseUrl } from "@foliomind/db/migrate";
import {
  cacheKeys,
  createRedis,
  grantRoleByEmail,
  invalidateUserSnapshot,
  UserLookupError,
} from "@foliomind/domain";
import { z } from "zod";

const args = process.argv.slice(2);
const reasonIndex = args.indexOf("--reason");
const reason = reasonIndex >= 0 ? (args[reasonIndex + 1] ?? "") : "Granted with promote-admin";
const email = args.find(
  (arg, index) => !arg.startsWith("--") && (reasonIndex < 0 || index !== reasonIndex + 1),
);

async function main(): Promise<void> {
  const parsedEmail = z.email().safeParse(email);
  if (!parsedEmail.success) {
    throw new UserLookupError('Usage: pnpm promote-admin <email> [--reason "<why>"]');
  }

  const url = migrationDatabaseUrl();
  console.log(`Database: ${describeDatabaseUrl(url)}`);
  const { db, close } = createDb({ url, role: "script" });
  try {
    const { userId, previousRole } = await grantRoleByEmail(db, {
      email: parsedEmail.data,
      role: "admin",
      actorId: null,
      reason,
    });
    console.log(
      previousRole === "admin"
        ? `Account ${userId} was already an admin; the grant is recorded again in the audit log.`
        : `Account ${userId} is now an admin (was ${previousRole}). Audit entry written.`,
    );

    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;
    if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
      const redis = createRedis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
      await invalidateUserSnapshot(redis, cacheKeys(resolveAppEnv(process.env)), userId);
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
