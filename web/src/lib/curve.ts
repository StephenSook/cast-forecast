import { K1B } from "@/lib/gates";

/** Coverage is held at 100 for every render; colorIntensity is the dose (K1b inverse condition). */
export const RENDER_COVERAGE = 100;

/** Round half to even, like Python's round(). */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function interp(x: number, keys: number[], vals: number[]): number {
  if (x <= keys[0]) return vals[0];
  const last = keys.length - 1;
  if (x >= keys[last]) return vals[last];
  let i = 1;
  while (keys[i] < x) i++;
  const t = (x - keys[i - 1]) / (keys[i] - keys[i - 1]);
  return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
}

/**
 * Port of castforecast.k1_render.coverage_for_alpha: invert the non-decreasing K1b curve.
 * A non-finite target throws RangeError, so NaN can never come back as a reachable intensity.
 */
export function colorIntensityForBlend(
  target: number,
  curve: ReadonlyMap<number, number> = K1B.g,
): { colorIntensity: number; predictedBlend: number; reachable: boolean } {
  if (!Number.isFinite(target)) throw new RangeError("target blend must be a finite number");
  const keys = [...curve.keys()].sort((a, b) => a - b);
  const vals = keys.map((k) => curve.get(k) as number);
  const last = vals.length - 1;
  if (target > vals[last]) return { colorIntensity: 100, predictedBlend: interp(100, keys, vals), reachable: false };
  let ci: number;
  if (target <= vals[0]) {
    ci = keys[0];
  } else {
    const i = vals.findIndex((v) => v >= target);
    const [lo, hi, aLo, aHi] = [keys[i - 1], keys[i], vals[i - 1], vals[i]];
    ci = aHi > aLo ? lo + ((hi - lo) * (target - aLo)) / (aHi - aLo) : lo;
  }
  const colorIntensity = Math.min(100, Math.max(0, roundHalfEven(ci)));
  return { colorIntensity, predictedBlend: interp(colorIntensity, keys, vals), reachable: true };
}
