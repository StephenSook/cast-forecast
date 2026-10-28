import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Live checks against the real YouCam API. Run by hand only (pnpm test:live); never part of pnpm test or CI.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Same stub as vitest.config.ts: the real package throws outside the react-server condition.
    alias: { "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
