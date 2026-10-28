import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The /evidence page says "Lint, types, tests, build and a bundle scan run on every push."
// This keeps that sentence true: the web job must run each of those, unconditionally.
const ci = readFileSync("../.github/workflows/ci.yml", "utf8");
const web = ci.slice(ci.indexOf("\n  web:"));

test("the web job runs lint, types, tests, build, the bundle scan and e2e on push", () => {
  expect(ci).toMatch(/^on:\n {2}push:\n {2}pull_request:/m);
  for (const cmd of ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build", "pnpm test:bundle", "pnpm e2e"]) {
    expect(web, cmd).toMatch(new RegExp(`^ {6}- run: ${cmd}$`, "m"));
  }
});
test("no web step can be skipped, softened or piped", () => {
  expect(web).not.toMatch(/continue-on-error|\|\| true|^\s+if:|\|\s*(tail|grep|head|tee)/m);
});
test("CI holds no secret", () => {
  expect(ci).not.toMatch(/secrets\.|YOUCAM_API_KEY|SESSION_SECRET/);
});
test("the key-value scan is never wired into CI", () => {
  expect(ci).not.toMatch(/test:keyscan/);
});
