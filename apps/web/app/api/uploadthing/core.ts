import {
  sourceUploadInputSchema,
  UPLOAD_REFUSALS,
  type UploadRefusalCode,
} from "@foliomind/contracts";
import {
  completeSourceUpload,
  deliverPending,
  invalidateUserSnapshot,
  prepareSourceUpload,
  setAvatar,
} from "@foliomind/domain";
import { createUploadthing, UTFiles, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { env } from "@/env";
import { getCacheKeys, getDb, getInngest, getRequestRedis, getUtApi } from "@/lib/clients";
import { checkRateLimitFor } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

/*
 * The one UploadThing file router (blueprint Section 25), served at
 * /api/uploadthing. Middleware admits an upload and records its intent;
 * `onUploadComplete` runs on the server (UploadThing's signed callback in
 * production, its dev hook locally) and is the only place records are created.
 * It must not depend on the browser's session: the user comes from metadata.
 *
 * FolioMind uses UploadThing's free plan (user decision, 2026-11-02), which has
 * public files only. Source PDFs therefore use the app's default ACL, and their
 * storage URLs never reach a browser: every read streams through the
 * authorized route `/api/documents/:id/file` (see SOURCE_ACL).
 */

/** Recorded on each source asset; switch both to "private" with a paid plan. */
const SOURCE_ACL = "public";

const f = createUploadthing({
  // The client shows these messages after "We couldn't add that file."
  errorFormatter: (error) => ({ message: error.message }),
});

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function refuse(code: UploadRefusalCode): never {
  throw new UploadThingError({
    code: code === "rate_limited" ? "FILE_LIMIT_EXCEEDED" : "BAD_REQUEST",
    message: UPLOAD_REFUSALS[code],
  });
}

/** Session, active account and the upload rate limit (Section 23: 10 per 10 minutes). */
async function uploader() {
  const user = await getCurrentUser();
  if (!user) throw new UploadThingError({ code: "FORBIDDEN", message: "Sign in to upload files." });
  if (user.status !== "active") refuse("account_inactive");
  if (!(await checkRateLimitFor("upload", user.id))) refuse("rate_limited");
  return user;
}

/** Best effort: a stored file that no record will own is removed now, or by the orphan sweep. */
async function discard(fileKey: string) {
  await getUtApi()
    .deleteFiles(fileKey)
    .catch(() => {});
}

export const fileRouter = {
  sourcePdf: f({ pdf: { maxFileSize: "32MB", maxFileCount: 1 } })
    .input(sourceUploadInputSchema)
    .middleware(async ({ files, input }) => {
      const user = await uploader();
      const admission = await prepareSourceUpload(getDb(), { userId: user.id, files });
      if (!admission.ok) refuse(admission.code);
      return {
        userId: user.id,
        title: input.title ?? null,
        [UTFiles]: files.map((file) => ({ ...file, customId: admission.customId })),
      };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const result = await completeSourceUpload(getDb(), {
        userId: metadata.userId,
        file,
        title: metadata.title ?? undefined,
        embedding: { model: env.JINA_EMBEDDING_MODEL, dimension: env.JINA_EMBEDDING_DIMENSION },
        acl: SOURCE_ACL,
      });
      if (!result.ok) {
        console.error(JSON.stringify({ event: "upload.refused_on_completion", code: result.code }));
        await discard(file.key);
        const code: UploadRefusalCode =
          result.code === "file_limit" ||
          result.code === "storage_limit" ||
          result.code === "file_too_large" ||
          result.code === "not_pdf"
            ? result.code
            : "upload_expired";
        return { documentId: null, error: code };
      }
      if (result.eventKey) {
        // Sent now; the one-minute dispatcher (Phase 6) re-sends anything undelivered.
        await deliverPending(getDb(), (events) => getInngest().send(events), {
          keys: [result.eventKey],
        }).catch(() => {});
      }
      return { documentId: result.documentId, error: null };
    }),

  avatarImage: f({ image: { maxFileSize: "2MB", maxFileCount: 1 } })
    .middleware(async ({ files }) => {
      const user = await uploader();
      const [file, ...rest] = files;
      if (!file || rest.length > 0) refuse("one_file");
      if (!AVATAR_TYPES.has(file.type) || file.size > AVATAR_MAX_BYTES) {
        throw new UploadThingError({
          code: "BAD_REQUEST",
          message: "Choose a JPEG, PNG or WebP image up to 2 MB.",
        });
      }
      return { userId: user.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      if (!AVATAR_TYPES.has(file.type) || file.size > AVATAR_MAX_BYTES) {
        await discard(file.key);
        return { avatarUrl: null };
      }
      await setAvatar(getDb(), { userId: metadata.userId, file, url: file.ufsUrl });
      await invalidateUserSnapshot(getRequestRedis(), getCacheKeys(), metadata.userId);
      return { avatarUrl: file.ufsUrl };
    }),
} satisfies FileRouter;

export type FolioMindFileRouter = typeof fileRouter;
