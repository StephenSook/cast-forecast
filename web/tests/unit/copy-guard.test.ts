import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { findCopyViolations, walk } from "../helpers/copyGuard";

test("copy guard catches each banned form", () => {
  for (const bad of ["a \u2014 b", "a \u2013 b", "SPF 50", "sun protection", "protects skin", "sunburn", "feel safe",
    "use less", "less product", 'className="text-amber-deep"', 'className="text-ink/60"', 'className="text-ink/5"',
    'className="text-paper/69"', 'className="bg-green text-paper"', 'className="text-paper p-2 bg-red"',
    "var(--visa)", 'className="bg-pink"', 'className="text-pink"'])
    expect(findCopyViolations(bad, "x.tsx").length, bad).toBeGreaterThan(0);
});

test("copy guard allows the near misses", () => {
  for (const ok of ["schema.safeParse(x); class A { protected y = 1 }", 'className="text-ink/70"',
    'className="text-paper/100"', "a pink cap", 'className="bg-red-deep text-paper"'])
    expect(findCopyViolations(ok, "x.tsx"), ok).toEqual([]);
});

test("web/src has no banned copy or banned classes", () => {
  const files = walk("src", [".ts", ".tsx", ".css", ".json", ".md"]);
  expect(files.length).toBeGreaterThanOrEqual(5);
  expect(files.flatMap((f) => findCopyViolations(readFileSync(f, "utf8"), f))).toEqual([]);
});
