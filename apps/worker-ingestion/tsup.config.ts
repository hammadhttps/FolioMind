import { defineConfig } from "tsup";

export default defineConfig({
  // The extraction child is its own file: it is forked, never imported.
  entry: ["src/index.ts", "src/extract-child.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they are bundled in.
  noExternal: [/^@foliomind\//],
});
