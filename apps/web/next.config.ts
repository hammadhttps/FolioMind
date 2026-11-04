import path from "node:path";
import type { NextConfig } from "next";
// Validates the environment at build and server start (Section 13).
import "./env";

// Standalone output in a monorepo must trace files from the repository root.
const repoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  // Shared workspace packages export TypeScript source.
  transpilePackages: [
    "@foliomind/ai",
    "@foliomind/contracts",
    "@foliomind/db",
    "@foliomind/domain",
    "@foliomind/pdf",
    "@foliomind/workflows",
  ],
  // The background functions fork the PDF parser as a separate file, so nothing
  // imports these and the bundler can't discover them on its own.
  outputFileTracingIncludes: {
    "/api/inngest": [
      "../../packages/workflows/src/ingestion/extract-child.mjs",
      "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
    ],
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Provider profile pictures (Section 22 rule 7) and public UploadThing files
  // such as custom avatars (Section 25).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.ufs.sh", pathname: "/f/**" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "s.gravatar.com" },
      { protocol: "https", hostname: "cdn.auth0.com" },
    ],
  },
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
