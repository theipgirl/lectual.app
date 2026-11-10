import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

// The harness has its own config so the ROOT `pnpm test` never sees these files
// (root vitest only picks *.test / *.spec). Aliases mirror the root config.
export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["scripts/design-harness/**/*.render.tsx"],
    setupFiles: ["scripts/design-harness/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/__mocks__/server-only.ts"),
    },
  },
});
