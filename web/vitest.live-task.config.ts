import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// The paid live check (one real YouCam task, up to 1 unit). Run by hand only (pnpm test:live:task); never part of
// pnpm test, pnpm test:live (0 units) or CI. tests/unit/live-configs.test.ts keeps the three include sets apart.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Same stub as vitest.config.ts: the real package throws outside the react-server condition.
    alias: { "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/live-task/**/*.test.ts"],
    environment: "node",
    testTimeout: 150_000,
  },
});
