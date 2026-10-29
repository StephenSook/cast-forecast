import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { E2E_SESSION_SECRET } from "../helpers/e2eEnv";
import { FORBIDDEN, scanForNeedles } from "./scan";

// The full catalogue (src/data/labels.json) is read by the server only; the browser gets the featured chips
// (src/data/bottles.json) and asks /api/labels for the rest. A label's set id is unique to it, so finding the set id of
// a label that is not a chip in a client chunk means the full catalogue was bundled for the browser.
const { bottles } = JSON.parse(readFileSync("src/data/labels.json", "utf8")) as { bottles: { featured: boolean; evidence: { setId: string } }[] };
const NOT_CHIPS = bottles.filter((b) => !b.featured).map((b) => b.evidence.setId);
const CHIPS = bottles.filter((b) => b.featured).map((b) => b.evidence.setId);
test("the full label catalogue stays on the server: no client chunk holds a label that is not a chip", () => {
  expect(NOT_CHIPS.length).toBeGreaterThan(100); // fails, never passes vacuously
  expect(scanForNeedles(".next/static", NOT_CHIPS, [".js"]).hits).toEqual([]);
});
test("the featured chips are in the client bundle, so the scan above can see catalogue data", () => {
  expect(scanForNeedles(".next/static", CHIPS, [".js"]).hits.length).toBeGreaterThan(0);
});

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
