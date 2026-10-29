import { defineConfig, devices } from "@playwright/test";

// The live-site checks against a deployed URL: a real try-on (1 YouCam unit) and a real skin-type read (10 units), per
// project. They never run in CI and never start a server. BASE_URL and LIVE_SELFIE are required, so a run without them
// fails instead of passing on nothing.
//   BASE_URL=https://cast-forecast-web.vercel.app LIVE_SELFIE=/path/to/selfie.jpg pnpm e2e:live --project desktop
const baseURL = process.env.BASE_URL;
if (!baseURL || !process.env.LIVE_SELFIE) throw new Error("e2e:live needs BASE_URL and LIVE_SELFIE");

export default defineConfig({
  testDir: "tests/live-site",
  retries: 0,
  workers: 1,
  timeout: 180_000,
  use: { baseURL, trace: "retain-on-failure" },
  // Each project spends its own units; pick one with --project. The phone runs WebKit, which shows layout faults a
  // Chromium phone viewport hides.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["iPhone 13"] } },
  ],
});
