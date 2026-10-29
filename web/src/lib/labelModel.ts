import { CELLS_CSV } from "@/data/plos2025/cells.generated";

/**
 * The label model the bottle predictions use, recomputed in the app from Gate 1's cells (port of
 * castforecast/label_model.py): dL* = (a + c × ZnO%) × (100 − L*before), the normalisation of Maldonado Lopez et al.,
 * PLOS ONE 2025, fitted by least squares. Gate 1 held each zinc oxide cell out by volunteer and by formulation.
 */
export type Cell = { volunteer: string; ita: string; formulation: string; zincOxidePct: number; lBefore: number; dL: number };

const HEADER = "volunteer,ita,formulation,zinc_oxide_pct,pairs,L_before,dL";
const DECIMAL = /^-?\d+(\.\d+)?$/;
const WHOLE = /^[1-9]\d*$/;

/**
 * The cells of data/plos2025/cells.csv. Throws on a header or a row it cannot read, so a bad table never fits: every
 * field present, numbers written out in full (a blank is not zero), zinc and L* on their 0 to 100 scales, and one cell
 * per volunteer and formulation, since the held-out test excludes by those two keys (Codex review of PR 13).
 */
export function parseCells(csv: string): Cell[] {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  if (header !== HEADER) throw new Error("cells.csv has an unexpected header");
  const seen = new Set<string>();
  return rows.map((row, i) => {
    const f = row.split(",").map((s) => s.trim());
    const bad = () => new Error(`cells.csv row ${i + 2} is malformed`);
    if (f.length !== 7 || f.some((s) => s === "")) throw bad();
    const [volunteer, ita, formulation, zinc, pairs, before, change] = f;
    if (![zinc, before, change].every((s) => DECIMAL.test(s)) || !WHOLE.test(pairs)) throw bad();
    const [zincOxidePct, lBefore, dL] = [Number(zinc), Number(before), Number(change)];
    if (zincOxidePct > 100 || lBefore > 100 || lBefore < 0) throw bad();
    const key = `${volunteer}\n${formulation}`;
    if (seen.has(key)) throw new Error(`cells.csv row ${i + 2} repeats ${volunteer} ${formulation}`);
    seen.add(key);
    return { volunteer, ita, formulation, zincOxidePct, lBefore, dL };
  });
}

/** Least-squares (a, c), solved from the 2x2 normal equations. */
export function fit(cells: readonly Cell[]): { a: number; c: number } {
  let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
  for (const cell of cells) {
    const w = 100 - cell.lBefore;
    const x2 = w * cell.zincOxidePct;
    s11 += w * w; s12 += w * x2; s22 += x2 * x2; t1 += w * cell.dL; t2 += x2 * cell.dL;
  }
  const det = s11 * s22 - s12 * s12;
  if (!(Math.abs(det) > 0)) throw new Error("the cells do not determine a and c");
  return { a: (t1 * s22 - t2 * s12) / det, c: (s11 * t2 - s12 * t1) / det };
}

export function predict(m: { a: number; c: number }, zincOxidePct: number, lBefore: number): number {
  return (m.a + m.c * zincOxidePct) * (100 - lBefore);
}

/** Gate 1's scheme: each target predicted by a fit on the pool minus its volunteer and its formulation. */
export function heldOutMae(targets: readonly Cell[], pool: readonly Cell[]): number {
  const errors = targets.map((held) => {
    const train = pool.filter((c) => c.volunteer !== held.volunteer && c.formulation !== held.formulation);
    return Math.abs(predict(fit(train), held.zincOxidePct, held.lBefore) - held.dL);
  });
  return errors.reduce((s, e) => s + e, 0) / errors.length;
}

export const CELLS: readonly Cell[] = parseCells(CELLS_CSV);
