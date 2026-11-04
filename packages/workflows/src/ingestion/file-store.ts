import { uploadThingFileUrl } from "@foliomind/contracts";
import { UTApi, UTFile } from "uploadthing/server";
import type { FileStore } from "../functions/ingestion/shared";

/*
 * UploadThing for the background functions (blueprint Section 25): download
 * addresses for stored files, snapshot uploads keyed by an operation `customId`
 * (looked up before re-uploading on retry), deletion and listing for the
 * cleanup sweeps. The free plan stores files with the app's default (public) ACL.
 */

export function createFileStore(token: string): FileStore {
  const api = new UTApi({ token, logLevel: "Error" });
  return {
    url: (fileKey) => uploadThingFileUrl(token, fileKey),

    async find(customId) {
      let key: string | undefined;
      try {
        const { data } = await api.getFileUrls(customId, { keyType: "customId" });
        key = data[0]?.key;
      } catch {
        return null;
      }
      if (!key) return null;
      const head = await fetch(uploadThingFileUrl(token, key), {
        method: "HEAD",
        signal: AbortSignal.timeout(15_000),
      });
      if (!head.ok) return null;
      return { key, size: Number(head.headers.get("content-length") ?? "0") };
    },

    async upload({ name, data, customId }) {
      // The type comes from the .pdf name.
      const file = new UTFile([new Uint8Array(data)], name, { customId });
      const result = await api.uploadFiles(file);
      if (result.error || !result.data) {
        throw new Error(`UploadThing upload failed: ${result.error?.code ?? "unknown"}`);
      }
      return { key: result.data.key, size: result.data.size };
    },

    async delete(fileKeys) {
      if (fileKeys.length === 0) return true;
      const result = await api.deleteFiles([...fileKeys]).catch(() => null);
      return Boolean(result?.success);
    },

    async list({ limit, offset }) {
      const { files } = await api.listFiles({ limit, offset });
      return files.map((file) => ({ key: file.key, uploadedAt: new Date(file.uploadedAt) }));
    },
  };
}
