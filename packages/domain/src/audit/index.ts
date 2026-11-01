import { auditLogs, type Executor } from "@foliomind/db";
import { z } from "zod";

/*
 * Append-only audit trail (blueprint Sections 4 and 12). Entries carry IDs,
 * codes and counts only; never document text, prompts, tokens or secrets.
 * The runtime database role cannot update or delete these rows.
 */

export const AUDIT_ACTIONS = [
  "user.role_granted",
  "user.signin_refused",
  "identity.linked",
  "identity.unlinked",
  "identity.link_refused",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Flat, short, primitive values: nothing that could carry private content. */
export const safeMetadataSchema = z
  .record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]),
  )
  .refine((value) => Object.keys(value).length <= 20, "At most 20 metadata keys");
export type SafeMetadata = z.infer<typeof safeMetadataSchema>;

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string;
  metadata?: SafeMetadata;
}

/** Write inside the caller's transaction so the entry commits with the change it records. */
export async function writeAudit(db: Executor, entry: AuditEntry): Promise<void> {
  const safeMetadata = safeMetadataSchema.parse(entry.metadata ?? {});
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    safeMetadata,
  });
}
