import { defineConfig, devices } from "@playwright/test";
import { E2E_SESSION_SECRET } from "./tests/helpers/e2eEnv";

const PORT = 3107;
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // The release-check contract sends no viewport, so it runs once, under desktop.
    { name: "phone", testIgnore: "**/release-check.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  // With no BASE_URL, every run (local or CI) serves the current production build with no YouCam key, so no test can
  // reach YouCam or spend a unit. The placeholder session secret only lets /api/health report session true for the
  // release-check contract; with no key every try-on route still answers not_configured.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `pnpm start --port ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { YOUCAM_API_KEY: "", SESSION_SECRET: E2E_SESSION_SECRET },
      },
});
