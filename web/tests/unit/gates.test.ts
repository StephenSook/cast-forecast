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
// Any import or require of fs or fs/promises, with or without the node: prefix.
const FS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`](?:node:)?fs(?:\/promises)?["'`]/;
test("the fs ban catches every import form and spares near misses", () => {
  for (const bad of ['import { readFileSync } from "fs";', "import fs from 'node:fs';", 'import { readFile } from "node:fs/promises";',
    'export * from "fs/promises";', 'const fs = require("fs");', "require( 'node:fs/promises' )", 'await import("fs")',
    "import(`node:fs`)", 'import "fs";', "import 'node:fs/promises';"])
    expect(bad, bad).toMatch(FS_IMPORT);
  for (const ok of ['import x from "fsevents";', 'import x from "./fs";', 'import x from "@/lib/fs";', 'const s = "fs";',
    'import { z } from "zod";', 'import "server-only";'])
    expect(ok, ok).not.toMatch(FS_IMPORT);
});
test("nothing under src reads files at runtime", () => {
  const files = walk("src", [".ts", ".tsx"]);
  expect(files.length).toBeGreaterThanOrEqual(5);
  for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(FS_IMPORT);
});
test("parses the five shipped gate rows, Gate 2 not run", () => {
  const rows = loadGates();
  expect(rows.map((r) => r.gate)).toEqual(["Gate 1", "K2", "K1", "K1b", "Gate 2"]);
  expect(rows.map((r) => r.verdict)).toEqual(["FAIL", "FAIL", "FAIL", "PASS", "OTHER"]);
  expect(rows[4].result).toMatch(/^Not run\. /);
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
