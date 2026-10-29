import { defineConfig, devices } from "@playwright/test";

// The live-site check: one real try-on (upload, tone, bottle, render) against a deployed URL, spending one YouCam unit.
// It never runs in CI and never starts a server. BASE_URL and LIVE_SELFIE are required, so a run without them fails
// instead of passing on nothing.
//   BASE_URL=https://cast-forecast-web.vercel.app LIVE_SELFIE=/path/to/selfie.jpg pnpm e2e:live
const baseURL = process.env.BASE_URL;
if (!baseURL || !process.env.LIVE_SELFIE) throw new Error("e2e:live needs BASE_URL and LIVE_SELFIE");

export default defineConfig({
  testDir: "tests/live-site",
  retries: 0,
  workers: 1,
  timeout: 180_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
