import { fork } from "node:child_process";
import type { ExtractionOutcome, Extractor } from "./extraction";

/*
 * Runs `extract-child.mjs` in its own process (blueprint Sections 8 and 9): PDF
 * parsing never shares memory or the event loop with the code that holds
 * secrets. The child gets a V8 heap cap and a minimal environment, and a hard
 * timeout kills it. The host says where the child and pdfjs-dist live, because
 * they differ between the Vercel route and the Docker worker.
 */

export interface ExtractorOptions {
  /** Absolute path of `extract-child.mjs` (or its bundled copy). */
  childPath: string;
  /** Absolute path of the pdfjs-dist package directory. */
  pdfjsRoot: string;
  /** Hard limit for one parse, in milliseconds. */
  timeoutMs?: number;
  /** V8 old-space limit for the child, in MiB. */
  memoryMb?: number;
}

export function createExtractor({
  childPath,
  pdfjsRoot,
  timeoutMs = 120_000,
  memoryMb = 512,
}: ExtractorOptions): Extractor {
  return (filePath, options) =>
    new Promise<ExtractionOutcome>((resolve, reject) => {
      const child = fork(childPath, [], {
        execArgv: [`--max-old-space-size=${memoryMb}`],
        // The child gets no secrets: only what Node itself needs.
        env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "production" },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "advanced",
      });
      let settled = false;
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < 2000) stderr += chunk.toString("utf8");
      });
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => resolve({ ok: false, code: "extraction_timeout" }));
      }, timeoutMs);

      child.once("message", (message) => finish(() => resolve(message as ExtractionOutcome)));
      child.once("error", (error) => finish(() => reject(error)));
      child.once("exit", (code, signal) =>
        finish(() => {
          // Out of memory or killed: the file is too heavy to parse within the limits.
          if (signal || /heap out of memory|Allocation failed/i.test(stderr)) {
            resolve({ ok: false, code: "extraction_timeout" });
          } else {
            // The child prints error names and codes only, so this is safe to log.
            reject(
              new Error(
                `extraction child exited with code ${code ?? "unknown"}: ${stderr.trim().slice(0, 300)}`,
              ),
            );
          }
        }),
      );
      child.send({ filePath, mode: options.mode, maxPages: options.maxPages, pdfjsRoot });
    });
}
