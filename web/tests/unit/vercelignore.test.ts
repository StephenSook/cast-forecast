import { readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { expect, test } from "vitest";
import { walk } from "../helpers/copyGuard";

// The Vercel build type-checks every .ts/.tsx the tsconfig includes, tests too, but .vercelignore keeps some test
// folders out of the upload. A static import into one of them passes locally and in CI and fails only on Vercel
// (it happened with tests/fixtures/catalogue-from-python.json on 2026-10-28). Runtime reads with readFileSync are
// fine: nothing type-checks them.
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'`](\.{1,2}\/[^"'`]+)["'`]/g;

function ignoredDirs(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/\/+$/, ""))
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!") && l.includes("/"));
}

function importsInto(file: string, text: string, dirs: string[]): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    const target = relative(".", normalize(join(dirname(file), m[1])));
    if (dirs.some((d) => target === d || target.startsWith(`${d}/`))) bad.push(`${file} -> ${m[1]}`);
  }
  return bad;
}

test("no type-checked file imports from a folder .vercelignore keeps out of the upload", () => {
  const dirs = ignoredDirs(readFileSync(".vercelignore", "utf8"));
  expect(dirs).toContain("tests/fixtures");
  const SELF = "tests/unit/vercelignore.test.ts"; // its own planted examples below would flag
  const files = [...walk("src", [".ts", ".tsx"]), ...walk("tests", [".ts", ".tsx"])].filter((f) => f !== SELF);
  expect(files.length).toBeGreaterThan(40); // a walk that finds nothing would pass vacuously
  expect(files.flatMap((f) => importsInto(f, readFileSync(f, "utf8"), dirs))).toEqual([]);
});

test("the check catches a static or dynamic import into an ignored folder and spares the rest", () => {
  const dirs = ["tests/fixtures"];
  const planted = 'import a from "../fixtures/x.json";\nconst b = await import("../fixtures/y.json");\n';
  expect(importsInto("tests/unit/t.ts", planted, dirs)).toHaveLength(2);
  const fine = 'import c from "../contracts/x.json";\nconst d = readFileSync("tests/fixtures/plain.jpg");\n';
  expect(importsInto("tests/unit/t.ts", fine, dirs)).toEqual([]);
});
