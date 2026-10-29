import path from "node:path";
import type { NextConfig } from "next";

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
    "@foliomind/workflows",
  ],
  cacheComponents: true,
  partialPrefetching: true,
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
