import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// The Vercel build type-checks every file the tsconfig includes, tests too, but only uploads what .vercelignore
// leaves in, and only this web folder. An import that resolves into an ignored path, or outside web/, passes locally
// and in CI (both have the whole tree) and fails only on Vercel: it happened with
// tests/fixtures/catalogue-from-python.json on 2026-10-28. Imports are read with TypeScript's own pre-processor
// (comments, dynamic imports) and resolved with the tsconfig's options (the @/ alias); .vercelignore is read with
// gitignore rules (globs, negation, last match wins, no re-including a file under an excluded folder).

type Rule = { negate: boolean; re: RegExp };

function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    if (/\*\*|[[\]\\]/.test(line)) throw new Error(`unsupported .vercelignore pattern: ${raw}`);
    const dirOnly = line.endsWith("/");
    line = line.replace(/\/+$/, "");
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    const body = [...line]
      .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.+^${}()|]/g, "\\$&")))
      .join("");
    rules.push({ negate, re: new RegExp((anchored ? "^" : "^(?:.*/)?") + body + (dirOnly ? "/" : "(?:/|$)")) });
  }
  return rules;
}

function matches(path: string, rules: Rule[]): boolean {
  let out = false;
  for (const r of rules) if (r.re.test(path)) out = !r.negate;
  return out;
}

/** Whether a path relative to web/ stays out of the upload; a file under an excluded folder cannot be re-included. */
function ignored(path: string, rules: Rule[]): boolean {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) if (matches(`${parts.slice(0, i).join("/")}/`, rules)) return true;
  return matches(path, rules);
}

const ROOT = process.cwd();
const CONFIG = ts.parseJsonConfigFileContent(ts.readConfigFile("tsconfig.json", ts.sys.readFile).config, ts.sys, ROOT);

function violationsIn(file: string, text: string, rules: Rule[]): string[] {
  const bad: string[] = [];
  for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
    const hit = ts.resolveModuleName(ref.fileName, file, CONFIG.options, ts.sys).resolvedModule;
    if (!hit || hit.isExternalLibraryImport) continue; // packages are installed on Vercel, not uploaded
    const target = relative(ROOT, hit.resolvedFileName);
    if (target.startsWith("..") || ignored(target, rules)) bad.push(`${relative(ROOT, file)} -> ${ref.fileName}`);
  }
  return bad;
}

const RULES = parseIgnore(readFileSync(".vercelignore", "utf8"));

test("no uploaded, type-checked file imports anything the Vercel upload leaves out", () => {
  // Ignored files Next generates during the build (next-env.d.ts, .next/types) are regenerated there, not uploaded.
  const uploaded = CONFIG.fileNames.filter((f) => !ignored(relative(ROOT, f), RULES));
  expect(uploaded.length).toBeGreaterThan(100); // a check that reads nothing would pass vacuously
  expect(CONFIG.fileNames.length - uploaded.length).toBeLessThan(10);
  expect(uploaded.flatMap((f) => violationsIn(f, readFileSync(f, "utf8"), RULES))).toEqual([]);
});

test("the ignore reader follows gitignore rules on the real .vercelignore", () => {
  expect(ignored("tests/fixtures/plain-640x480.jpg", RULES)).toBe(true);
  expect(ignored("tests/contracts/catalogue-from-python.json", RULES)).toBe(false);
  expect(ignored("node_modules/zod/index.js", RULES)).toBe(true);
  expect(ignored("src/x/a.tsbuildinfo", RULES)).toBe(true);
  expect(ignored(".env.local", RULES)).toBe(true);
  expect(ignored(".env.example", RULES)).toBe(false);
  const reinclude = parseIgnore("tests/fixtures/\n!tests/fixtures/keep.json\n");
  expect(ignored("tests/fixtures/keep.json", reinclude)).toBe(true);
  expect(() => parseIgnore("tests/**/x.json")).toThrow(/unsupported/);
});

// Codex review of PR #7: comment-separated imports, the @/ alias and a glob rule all slipped past the first guard.
test("planted imports in every form are caught, including under a glob rule", () => {
  const withGlob = [...RULES, ...parseIgnore("tests/contracts/*.json")];
  const file = join(ROOT, "tests/unit/planted.ts");
  const planted = [
    'import a from /* c */ "../contracts/catalogue-from-python.json";',
    'const b = await import/* c */("../contracts/catalogue-from-python.json");',
    'import c from "@/../tests/contracts/catalogue-from-python.json";',
  ].join("\n");
  expect(violationsIn(file, planted, withGlob)).toHaveLength(3);
  expect(violationsIn(file, planted, RULES)).toEqual([]);
  const routes = join(ROOT, "tests/unit/routes.render.test.ts");
  expect(violationsIn(routes, readFileSync(routes, "utf8"), withGlob)).toEqual([
    "tests/unit/routes.render.test.ts -> ../contracts/catalogue-from-python.json",
  ]);
});

test("an import from outside web/ is caught: only web/ is uploaded", () => {
  const file = join(ROOT, "tests/unit/planted.ts");
  expect(violationsIn(file, 'import r from "../../../docs/gates/k1b-results.json";', RULES)).toHaveLength(1);
});
