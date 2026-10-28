import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    // The real package throws outside the react-server condition, so unit tests import a no-op stub.
    alias: { "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/ui/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // UI test files opt into jsdom with a `// @vitest-environment jsdom` first line.
    environment: "node",
  },
});
