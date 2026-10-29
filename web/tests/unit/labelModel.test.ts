import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import * as labelModelRoute from "@/app/api/label-model/route";
import { CELLS_CSV } from "@/data/plos2025/cells.generated";
import { CATALOGUE, RETAIL_ERROR_L } from "@/lib/catalogue";
import { CELLS, LABEL_FIT, LIGHTNESS_RANGE, ZINC_RANGE, fit, heldOutMae, parseCells, predict, predictInStudy } from "@/lib/labelModel";
import { labelModelPayload } from "@/server/routes/labelModel";

const source = resolve(__dirname, "../../../data/plos2025/cells.csv");

test("the synced cells match data/plos2025/cells.csv", () => {
  expect(existsSync(source), `missing ${source}`).toBe(true); // fails, never skips
  expect(CELLS_CSV, "run pnpm sync:gates (cells.csv)").toBe(readFileSync(source, "utf8"));
  expect(CELLS).toHaveLength(78);
});

// docs/gates/gate1-results.md: label percent model, strict leave-one-cell-out; overall 1.61, darker skin 1.80,
// benchmark 2.35, on 65, 30 and 13 cells.
test("the route recomputes Gate 1's held-out errors from the table", () => {
  const { heldOut, fit: f } = labelModelPayload();
  expect(f.cells).toBe(78);
  expect(heldOut.cells).toBe(65); expect(heldOut.maeL).toBeCloseTo(1.61, 2);
  expect(heldOut.darkerSkin.cells).toBe(30); expect(heldOut.darkerSkin.maeL).toBeCloseTo(1.8, 2);
  expect(heldOut.benchmark.cells).toBe(13); expect(heldOut.benchmark.maeL).toBeCloseTo(2.35, 2);
});

test("the app's fit is the one Python used: it reproduces every shipped prediction", () => {
  const m = fit(CELLS);
  let checked = 0;
  for (const bottle of CATALOGUE) {
    const zinc = bottle.evidence.zincOxidePct;
    for (const t of bottle.tones) {
      expect(predict(m, zinc, t.lStar), `${bottle.id} ${t.lStar}`).toBeCloseTo(t.whitening.value, 5);
      checked++;
    }
  }
  expect(checked).toBeGreaterThanOrEqual(40);
});

// tests/test_label_model.py: ZINC_RANGE is (5.0, 30.0) and LIGHTNESS_RANGE sits inside (43, 45) and (68, 69). Both
// are the zinc cells' ends, as in castforecast/label_model.py, not the ends of every cell.
test("the study range is the zinc cells' ends, and predictInStudy refuses outside it, ends included", () => {
  const zinc = CELLS.filter((c) => c.zincOxidePct > 0);
  expect(ZINC_RANGE).toEqual([5, 30]);
  expect(LIGHTNESS_RANGE).toEqual([Math.min(...zinc.map((c) => c.lBefore)), Math.max(...zinc.map((c) => c.lBefore))]);
  expect(LIGHTNESS_RANGE[0]).toBeGreaterThan(43); expect(LIGHTNESS_RANGE[0]).toBeLessThan(45);
  expect(LIGHTNESS_RANGE[1]).toBeGreaterThan(68); expect(LIGHTNESS_RANGE[1]).toBeLessThan(69);
  expect(LABEL_FIT).toEqual(fit(CELLS));
  for (const [z, l] of [[5, LIGHTNESS_RANGE[0]], [30, LIGHTNESS_RANGE[1]], [20, 55]]) {
    expect(predictInStudy(z, l)).toEqual({ value: predict(LABEL_FIT, z, l) });
  }
  // The cases tests/test_label_model.py refuses.
  for (const [z, l] of [[3, 55], [31, 55], [20, 40], [20, 72], [Number.NaN, 55], [20, Number.NaN]]) {
    const r = predictInStudy(z, l);
    expect("refusal" in r && r.refusal, `${z} ${l}`).toMatch(/is outside the study's/);
  }
});

// castforecast/label_catalogue.py widens every prediction by RETAIL_ERROR_L; the app's copy must be that number, and
// that number must be the benchmark error the route recomputes.
test("RETAIL_ERROR_L is every shipped band's half-width and Gate 1's benchmark error", () => {
  for (const b of CATALOGUE) {
    for (const w of [b.whitening, ...b.tones.map((t) => t.whitening)]) {
      expect(w.high - w.value, b.id).toBeCloseTo(RETAIL_ERROR_L, 5);
      expect(w.value - w.low, b.id).toBeCloseTo(RETAIL_ERROR_L, 5);
    }
  }
  expect(labelModelPayload().heldOut.benchmark.maeL).toBeCloseTo(RETAIL_ERROR_L, 2);
});

test("held-out fits never see the held cell's volunteer or formulation", () => {
  const held = CELLS.find((c) => c.zincOxidePct > 0)!;
  const shifted = CELLS.map((c) => (c.volunteer === held.volunteer || c.formulation === held.formulation) && c !== held ? { ...c, dL: c.dL + 50 } : c);
  // Corrupting only the excluded cells cannot change the held cell's prediction.
  expect(heldOutMae([held], shifted)).toBeCloseTo(heldOutMae([held], CELLS), 10);
});

test("a malformed table is refused, never fitted", () => {
  const ok = "volunteer,ita,formulation,zinc_oxide_pct,pairs,L_before,dL\nA1,Light,5% ZnO,5.0,3,60.0,-1.0\n";
  expect(parseCells(ok)).toHaveLength(1);
  expect(() => parseCells(ok.replace("volunteer", "who"))).toThrow(/header/);
  expect(() => parseCells(ok.replace("60.0", "sixty"))).toThrow(/row 2/);
  expect(() => parseCells(`${ok}A2,Light,5% ZnO,5.0\n`)).toThrow(/row 3/);
  // Codex review of PR 13: a blank volunteer would join training when that volunteer is held out, and a blank
  // number would read as 0.
  expect(() => parseCells(ok.replace("A1,", ","))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace(",5% ZnO,", ", ,"))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace("60.0", ""))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace(",-1.0", ","))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace(",3,", ",0,"))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace("60.0", "533.92"))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace("60.0", "1e2"))).toThrow(/row 2/);
  expect(() => parseCells(`${ok}A1,Light,5% ZnO,5.0,3,61.0,-1.2\n`)).toThrow(/row 3 repeats A1/);
  // Codex review of PR 13, round 2: a negative zinc percent fitted, and a 400-digit decimal overflowed to Infinity.
  expect(() => parseCells(ok.replace(",5.0,", ",-5.0,"))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace(",-1.0", `,${"9".repeat(400)}`))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace(",-1.0", `,-${"9".repeat(400)}`))).toThrow(/row 2/);
  expect(() => parseCells(ok.replace(",-1.0", ",-100.5"))).toThrow(/row 2/);
  for (const [zinc, before] of [["0.0", "0.0"], ["100.0", "100.0"]]) {
    expect(parseCells(ok.replace(",5.0,", `,${zinc},`).replace("60.0", before))).toHaveLength(1);
  }
  expect(() => fit([])).toThrow(/do not determine/);
});

test("label-model route is static and answers the payload", async () => {
  expect(labelModelRoute.dynamic).toBe("force-static");
  const res = await labelModelRoute.GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(JSON.parse(JSON.stringify(labelModelPayload())));
});
