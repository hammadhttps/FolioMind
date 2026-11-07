import { defineConfig } from "tsup";

export default defineConfig({
  // The PDF parser that counts an export's pages is its own file: forked, never imported.
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
