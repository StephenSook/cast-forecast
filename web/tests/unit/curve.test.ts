import { expect, test } from "vitest";
import { RENDER_COVERAGE, colorIntensityForBlend, roundHalfEven } from "@/lib/curve";
import { K1B } from "@/lib/gates";

// Expected values computed with castforecast.k1_render.coverage_for_alpha.
test.each([[0, 0, 0, true], [0.10, 29, 0.10102367485191005, true], [0.169, 49, 0.16971764011555973, true],
  [0.25, 73, 0.24932342783823652, true], [0.3545024830997824, 100, 0.3545024830997824, true],
  [0.36, 100, 0.3545024830997824, false], [-0.1, 0, 0, true], [0.05, 15, 0.051567307101740824, true]])(
  "blend %f maps like coverage_for_alpha", (t, ci, pred, reach) => {
    const r = colorIntensityForBlend(t);
    expect(r.colorIntensity).toBe(ci); expect(r.predictedBlend).toBeCloseTo(pred, 12); expect(r.reachable).toBe(reach);
  });
test("recomputes every recorded K1b inverse plan entry", () => {
  expect(K1B.inversePlan).toHaveLength(3);
  for (const p of K1B.inversePlan) expect(colorIntensityForBlend(p.targetAlpha).colorIntensity).toBe(p.colorIntensity);
});
test("roundHalfEven matches Python round", () => expect([48.5, 49.5, 0.5, 1.5, 2.4999].map(roundHalfEven)).toEqual([48, 50, 0, 2, 2]));
test("render coverage is the K1b inverse condition", () => expect(RENDER_COVERAGE).toBe(100));
