"use server";

import { deleteAccountSchema, type ActionResult } from "@foliomind/contracts";
import {
  invalidateUserSnapshot,
  isRecentAuthentication,
  markAssetsDeleted,
  markIdentityDeleted,
  markSubscriptionCancelled,
  requestAccountDeletion,
} from "@foliomind/domain";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { auth0IdentityAdmin } from "@/lib/auth/identity-admin";
import { billingConfigured, getBillingGateway } from "@/lib/billing/server";
import { invalidateCatalog } from "@/lib/catalog/invalidate";
import { getCacheKeys, getDb, getRequestRedis, getUtApi } from "@/lib/clients";
import { rateLimitAction } from "@/lib/rate-limit";
import { getFreshUser } from "@/lib/session";

import { logEvent } from "@/lib/log";
/*
 * Delete account (blueprint Section 6; Section 28 "Delete account": an exact
 * confirmation phrase and recent authentication). The account is marked
 * deleting and its access revoked in one transaction; then, after the
 * response, its files are removed, any renewing subscription is cancelled and
 * the Auth0 identity is deleted. Whatever fails there, the daily cleanup
 * retries, and only then is the row anonymized.
 */

function logFailure(step: string, error: unknown) {
  logEvent("error", "account.deletion_step_failed", { step, name: (error as Error)?.name });
}

export async function deleteAccountAction(input: unknown): Promise<ActionResult> {
  const user = await getFreshUser();
  if (!user || user.status !== "active") {
    return { ok: false, code: "unauthenticated", formError: "Sign in again to continue." };
  }
  // Section 23: account deletion is limited to 5 an hour and refused when Redis can't answer.
  const limited = await rateLimitAction("accountSecurity", await headers());
  if (limited) return limited;
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      formError: parsed.error.issues[0]?.message,
    };
  }
  if (!isRecentAuthentication(user.signedInAt)) {
    return {
      ok: false,
      code: "reauthentication_required",
      formError: "For your security, sign in again, then delete your account within 10 minutes.",
    };
  }

  const db = getDb();
  const result = await requestAccountDeletion(db, { userId: user.id });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      formError:
        result.code === "admin_account"
          ? "Administrator accounts can't be deleted here. Remove the admin role through the audited process first."
          : "This account can't be deleted right now.",
    };
  }
  // Suspension-style: every request now refuses the account at once.
  await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), user.id);
  if (result.bookIds.length > 0 || result.publisherSlugs.length > 0) {
    await invalidateCatalog({ bookIds: result.bookIds, publisherSlugs: result.publisherSlugs });
  }

  after(async () => {
    if (result.fileKeys.length > 0 && env.UPLOADTHING_TOKEN) {
      try {
        const deleted = await getUtApi().deleteFiles(result.fileKeys);
        if (deleted.success) await markAssetsDeleted(db, result.fileKeys);
      } catch (error) {
        logFailure("files", error);
      }
    }
    if (billingConfigured()) {
      for (const subscriptionId of result.subscriptionIds) {
        try {
          await getBillingGateway().cancelSubscription(subscriptionId);
          await markSubscriptionCancelled(db, subscriptionId);
        } catch (error) {
          logFailure("subscription", error);
        }
      }
    }
    if (env.AUTH0_MGMT_CLIENT_ID && env.AUTH0_MGMT_CLIENT_SECRET) {
      try {
        await auth0IdentityAdmin.deleteUser(result.auth0Sub);
        await markIdentityDeleted(db, user.id);
      } catch (error) {
        logFailure("identity", error);
      }
    }
  });
  return { ok: true, data: undefined };
}
