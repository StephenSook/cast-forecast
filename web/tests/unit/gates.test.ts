import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { GATES_README } from "@/data/gates/readme.generated";
import { K1B, githubDocUrl, loadGates } from "@/lib/gates";
import { walk } from "../helpers/copyGuard";

const gatesSrc = (f: string) => resolve(__dirname, "../../../docs/gates", f);

test("synced gates files match docs/gates", () => {
  for (const f of ["README.md", "k1b-results.json"]) expect(existsSync(gatesSrc(f)), `missing ${gatesSrc(f)}`).toBe(true); // fails, never skips
  expect(GATES_README, "run pnpm sync:gates (README.md)").toBe(readFileSync(gatesSrc("README.md"), "utf8"));
  expect(readFileSync("src/data/gates/k1b-results.json").equals(readFileSync(gatesSrc("k1b-results.json"))), "run pnpm sync:gates (k1b-results.json)").toBe(true);
});
test("nothing under src reads files at runtime", () => {
  const files = walk("src", [".ts", ".tsx"]);
  expect(files.length).toBeGreaterThanOrEqual(5);
  for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/from ["'](node:)?fs(\/promises)?["']/);
});
test("parses the four shipped gate rows", () => {
  const rows = loadGates();
  expect(rows.map((r) => r.gate)).toEqual(["Gate 1", "K2", "K1", "K1b"]);
  expect(rows.map((r) => r.verdict)).toEqual(["FAIL", "FAIL", "FAIL", "PASS"]);
});
test("resolves relative md links to GitHub", () =>
  expect(loadGates()[3].links.map((l) => l.href)).toContain(githubDocUrl("k1b-preregistration.md")));
test("keeps absolute links as they are", () =>
  expect(loadGates()[1].links.map((l) => l.href)).toContain(
    "https://github.com/StephenSook/cast-forecast/blob/043293acc84c72420c922877d3c38fa1c5d844a5/castforecast/k2_tone.py"));
test("K1B reads the published numbers", () => {
  expect(K1B.pass).toBe(true); expect(K1B.r2).toBeCloseTo(0.98242, 5); expect(K1B.g100).toBeCloseTo(0.35450, 5);
  expect(K1B.inverseGatingDe00).toBeCloseTo(1.17176, 5); expect(K1B.unitsSpent).toBe(19);
  expect(K1B.nFitted).toBe(16); expect(K1B.inverseDeMax).toBe(2);
});
