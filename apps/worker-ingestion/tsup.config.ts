import { defineConfig } from "tsup";

export default defineConfig({
  // The extraction child is its own file: it is forked, never imported.
  entry: {
    index: "src/index.ts",
    "extract-child": "../../packages/workflows/src/ingestion/extract-child.mjs",
  },
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they are bundled in.
  noExternal: [/^@foliomind\//],
});
