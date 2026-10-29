import { expect, test } from "vitest";
import { cellParts, CURVE_Y_MAX, curveLabel, curvePoints, DATA_URL, evidenceSteps, evidenceTiles, factLine, originFrom } from "@/lib/evidence";
import { K1B } from "@/lib/gates";

test("tiles read the recorded K1b numbers", () => {
  expect(evidenceTiles(K1B).map((t) => t.value)).toEqual(["0.982", "1.17", "0.355", "19"]);
  expect(evidenceTiles(K1B).map((t) => t.label)).toEqual([
    "blend model fit (R squared, 16 renders)",
    "dE00 to target on a second selfie (bar 2.0)",
    "blend strength at colorIntensity 100",
    "API units spent on K1b",
  ]);
});

// Review: the render count and the bar come from named k1b-results.json keys, never from literals in the page.
test("the render count and the dE00 bar are read from the summary, never hardcoded", () => {
  const moved = evidenceTiles({ ...K1B, nFitted: 9, inverseDeMax: 1.5 }).map((t) => t.label);
  expect(moved[0]).toContain("9 renders");
  expect(moved[1]).toContain("bar 1.5");
  expect(evidenceTiles({ ...K1B, g100: 0.5, unitsSpent: 7, r2: 0.9, inverseGatingDe00: 0.25 }).map((t) => t.value)).toEqual(["0.900", "0.25", "0.500", "7"]);
});

test("steps print the curl and link the study table and the labels", () => {
  const steps = evidenceSteps("https://x.test", 8);
  expect(steps.map((s) => s.title)).toEqual(["Read the gates", "Check the render mapping", "The data", "Read the code"]);
  expect(steps[1].code).toBe("curl -s https://x.test/api/gates");
  expect(steps[2].href).toBe(DATA_URL);
  expect(steps[2].body).toContain("each of the 8 bottles");
  expect(DATA_URL).toBe("https://github.com/StephenSook/cast-forecast/tree/main/data");
  expect(steps[0].href).toContain("/docs/gates/README.md");
  expect(steps[3].href).toBe("https://github.com/StephenSook/cast-forecast");
});

// docs/gates/gate1-results.md discloses that Gate 1's first rows were printed before its rule, so "written before its data" is false.
test("step 1 does not claim every rule preceded its data", () => {
  const body = evidenceSteps("https://x.test", 0)[0].body;
  expect(body).toBe("Each gate has a written pass rule, and every result stays, pass or fail. Gate 1's page notes what was looked at before its rule was written.");
  expect(body).not.toMatch(/written before its data/);
});

test("the fact line carries the counts and the 7 character release", () => {
  expect(factLine(0, 4, "63868ece36982b8a")).toBe("Bottles: 0. Gates on record: 4. Release 63868ec.");
});

test("the curve points and its label come from the K1b fit", () => {
  expect(curvePoints(K1B).map((p) => p.x)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(curveLabel(K1B)).toBe("K1b blend strength by colorIntensity: 0.355 at 100");
  expect(curveLabel({ ...K1B, g: new Map([[0, 0], [50, 0.123456]]) })).toBe("K1b blend strength by colorIntensity: 0.123 at 50");
  expect(CURVE_Y_MAX).toBe(0.4);
});

test("a gate cell splits into text and resolved links", () => {
  expect(cellParts("FAIL 2 of 3. [k2-results.md](k2-results.md) end")).toEqual([
    { text: "FAIL 2 of 3. " },
    { text: "k2-results.md", href: "https://github.com/StephenSook/cast-forecast/blob/main/docs/gates/k2-results.md" },
    { text: " end" },
  ]);
  expect(cellParts("[a](https://example.test/x)")).toEqual([{ text: "a", href: "https://example.test/x" }]);
  expect(cellParts("plain")).toEqual([{ text: "plain" }]);
});

test("the origin comes from the forwarded headers, then host, and refuses a malformed one", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  expect(originFrom(h({ "x-forwarded-proto": "https", "x-forwarded-host": "cast.example.test" }))).toBe("https://cast.example.test");
  expect(originFrom(h({ "x-forwarded-proto": "https,http", "x-forwarded-host": "a.test,b.test" }))).toBe("https://a.test");
  expect(originFrom(h({ host: "localhost:3107" }))).toBe("http://localhost:3107");
  expect(originFrom(h({ host: "evil.test/ x" }))).toBe("http://localhost:3000");
  expect(originFrom(h({ "x-forwarded-proto": "javascript", host: "a.test" }))).toBe("http://a.test");
  expect(originFrom(h({}))).toBe("http://localhost:3000");
});
