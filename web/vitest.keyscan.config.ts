import { defineConfig } from "vitest/config";

// Owner-only: scans the built client bundle for the live YOUCAM_API_KEY value. Never part of pnpm test or CI.
export default defineConfig({
  test: { include: ["tests/keyscan/**/*.test.ts"], environment: "node" },
});
