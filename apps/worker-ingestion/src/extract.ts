import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExtractor, type Extractor } from "@foliomind/workflows/worker-a";

/*
 * Where the Docker worker finds the extraction child and pdfjs-dist. The bundle
 * has its own copy of the child next to it (tsup.config.ts); from source
 * (`pnpm dev`, tests) it comes straight from @foliomind/workflows.
 */

const require = createRequire(import.meta.url);
const runningFromSource = import.meta.url.endsWith(".ts");

export function createWorkerExtractor(
  options: { timeoutMs?: number; memoryMb?: number } = {},
): Extractor {
  return createExtractor({
    childPath: fileURLToPath(
      runningFromSource
        ? import.meta.resolve("@foliomind/workflows/extract-child")
        : new URL("./extract-child.js", import.meta.url),
    ),
    pdfjsRoot: path.dirname(require.resolve("pdfjs-dist/package.json")),
    ...options,
  });
}
