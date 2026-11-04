/**
 * `pnpm check:route-trace` (after `pnpm build`) — fails when the background
 * functions route would deploy without the files it forks and loads at runtime.
 * Nothing imports them, so a wrong path in `outputFileTracingIncludes` would
 * otherwise only show up as failed uploads on the live site.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const traceFile = path.resolve(
  import.meta.dirname,
  "../apps/web/.next/server/app/api/inngest/route.js.nft.json",
);

const REQUIRED: [string, RegExp][] = [
  ["PDF parsing child process", /packages\/workflows\/src\/ingestion\/extract-child\.mjs$/],
  ["PDF.js", /pdfjs-dist\/legacy\/build\/pdf\.mjs$/],
  ["PDF.js worker", /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs$/],
  ["PDF.js standard fonts", /pdfjs-dist\/standard_fonts\/.+/],
  ["Browserless client", /puppeteer-core\//],
];

const { files } = JSON.parse(readFileSync(traceFile, "utf8")) as { files: string[] };
const missing = REQUIRED.filter(([, pattern]) => !files.some((file) => pattern.test(file)));

if (missing.length > 0) {
  console.error(`/api/inngest is missing: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
console.log(
  `/api/inngest ships its ${REQUIRED.length} runtime dependencies (${files.length} files).`,
);
