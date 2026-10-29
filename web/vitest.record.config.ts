import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Records the sample face's results with real YouCam tasks (about 50 units). Run by hand only (pnpm record:sample);
// never part of pnpm test, the live suites or CI. tests/unit/live-configs.test.ts keeps the include sets apart.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Same stub as vitest.config.ts: the real package throws outside the react-server condition.
    alias: { "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/record/**/*.test.ts"],
    environment: "node",
    testTimeout: 1_800_000,
  },
});
