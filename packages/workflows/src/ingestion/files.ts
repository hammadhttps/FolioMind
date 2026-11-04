import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ProviderError,
  providerErrorFromResponse,
  providerNetworkError,
} from "@foliomind/contracts";
import { JobFailure } from "@foliomind/domain";

/*
 * Worker scratch files (blueprint Section 13): each step that needs the PDF
 * downloads it into its own temporary directory and removes it in `finally`,
 * so nothing outlives the step and a restarted worker starts clean.
 */

export interface DownloadedFile {
  path: string;
  bytes: number;
  sha256: string;
}

export async function withDownloadedFile<T>(
  url: string,
  options: { maxBytes: number; tempDir?: string | undefined; timeoutMs?: number },
  fn: (file: DownloadedFile) => Promise<T>,
): Promise<T> {
  const dir = path.join(options.tempDir ?? tmpdir(), "foliomind", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const file = await download(url, path.join(dir, "source.pdf"), options);
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function download(
  url: string,
  target: string,
  { maxBytes, timeoutMs = 120_000 }: { maxBytes: number; timeoutMs?: number },
): Promise<DownloadedFile> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw providerNetworkError("UploadThing", error);
  }
  if (response.status === 404 || response.status === 410) throw new JobFailure("file_missing");
  if (!response.ok || !response.body)
    throw await providerErrorFromResponse("UploadThing", response);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new JobFailure("file_too_large");

  const hash = createHash("sha256");
  let bytes = 0;
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  source.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes) source.destroy(new JobFailure("file_too_large"));
    else hash.update(chunk);
  });
  try {
    await pipeline(source, createWriteStream(target));
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    if (error instanceof ProviderError) throw error;
    throw providerNetworkError("UploadThing", error);
  }
  return { path: target, bytes, sha256: hash.digest("hex") };
}
