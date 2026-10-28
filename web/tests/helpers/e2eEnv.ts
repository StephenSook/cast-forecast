// The session secret the e2e server runs with (playwright.config.ts). A placeholder, set only at `next start`, never
// at build time and never in CI or Vercel: with it /api/health reports session true, so the deploy release check can
// run against the e2e server (tests/e2e/release-check.spec.ts). There is still no YouCam key, so every try-on route
// answers not_configured. tests/bundle/client-bundle.test.ts checks it never reaches the browser.
// The gitleaks:allow mark is for this hand-checked placeholder and nothing else.
export const E2E_SESSION_SECRET = "e2e-placeholder-session-secret-0123456789"; // gitleaks:allow
