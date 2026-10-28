import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { contrast, FOCUS_ON_SURFACE, readTokens, TEXT_ON_FILL } from "@/ui/tokens";

const css = readFileSync("src/app/globals.css", "utf8");
const t = readTokens(css);

test("every allowed text pair is at least 4.5:1", () => {
  for (const [fg, bg, a] of TEXT_ON_FILL) expect(contrast(t, fg, bg, a), `${fg} on ${bg} ${a ?? 1}`).toBeGreaterThanOrEqual(4.5);
});

test("focus outlines are at least 3:1 on every surface", () => {
  for (const [fg, bg] of FOCUS_ON_SURFACE) expect(contrast(t, fg, bg)).toBeGreaterThanOrEqual(3);
});

test("known Lullabuy failures stay below 4.5 so they stay banned", () => {
  expect(contrast(t, "amber-deep", "paper")).toBeCloseTo(2.35, 2);
  expect(contrast(t, "paper", "green")).toBeCloseTo(3.08, 2);
  expect(contrast(t, "ink", "sand", 0.6)).toBeCloseTo(4.33, 2);
});

test("dropped tokens are gone", () => {
  for (const n of ["--visa:", "--pink:", "--radius-card:", "--ease-osmo:", "--ease-smooth:", "--ease-bounce:", "--ease-elastic-out:", ".state-"]) expect(css).not.toContain(n);
});
