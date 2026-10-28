import { expect, test } from "vitest";
import { E2E_SESSION_SECRET } from "../helpers/e2eEnv";
import { FORBIDDEN, scanForNeedles } from "./scan";

// The browser receives client chunks (.next/static) and prerendered pages with their RSC payloads (.next/server/app).
// Server JS under .next/server/app legitimately names YOUCAM_API_KEY, so only .html and .rsc are scanned there.
const PAGES = [".html", ".rsc"];

test("client bundle exists and is not trivial", () => {
  expect(scanForNeedles(".next/static", FORBIDDEN, [".js"]).files).toBeGreaterThanOrEqual(5); // fails, never skips
});
test("client bundle carries no key name, no Bearer, no YouCam host", () => {
  expect(scanForNeedles(".next/static", FORBIDDEN, [".js"]).hits).toEqual([]);
});
test("prerendered pages exist and are not trivial", () => {
  expect(scanForNeedles(".next/server/app", FORBIDDEN, PAGES).files).toBeGreaterThanOrEqual(3); // /, /compare, /evidence
});
test("prerendered pages and RSC payloads carry no key name, no Bearer, no YouCam host", () => {
  expect(scanForNeedles(".next/server/app", FORBIDDEN, PAGES).hits).toEqual([]);
});
test("the e2e placeholder session secret is in no client chunk and no prerendered page", () => {
  expect(scanForNeedles(".next/static", [E2E_SESSION_SECRET], [".js"]).hits).toEqual([]);
  expect(scanForNeedles(".next/server/app", [E2E_SESSION_SECRET], PAGES).hits).toEqual([]);
});
