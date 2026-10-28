import { defineConfig } from "vitest/config";

// Scans the built client bundle (.next/static) for key names and the YouCam host. Needs `pnpm build` first. Runs in CI.
export default defineConfig({
  test: { include: ["tests/bundle/**/*.test.ts"], environment: "node" },
});
