import "server-only";
import { CELLS, type Cell, fit, heldOutMae } from "@/lib/labelModel";

export type LabelModelPayload = {
  model: string;
  source: { study: string; table: string };
  fit: { a: number; c: number; cells: number };
  heldOut: { cells: number; maeL: number; darkerSkin: { cells: number; maeL: number }; benchmark: { cells: number; maeL: number } };
};

const round = (x: number) => Math.round(x * 1e4) / 1e4;
const group = (targets: readonly Cell[]) => ({ cells: targets.length, maeL: round(heldOutMae(targets, CELLS)) });

/**
 * The model behind every bottle's prediction, refitted here from the committed table, and Gate 1's held-out error
 * recomputed: overall, on the study's darker skin (ITA Brown and Tan), and on its differently formulated benchmark
 * product, the error each result's band uses.
 */
export function labelModelPayload(): LabelModelPayload {
  const zinc = CELLS.filter((c) => c.zincOxidePct > 0);
  const m = fit(CELLS);
  return {
    model: "dL* = (a + c * ZnO%) * (100 - L*before)",
    source: {
      study: "Maldonado Lopez et al., PLOS ONE 2025, doi 10.1371/journal.pone.0319891 (raw data CC BY 4.0)",
      table: "data/plos2025/cells.csv",
    },
    fit: { a: m.a, c: m.c, cells: CELLS.length },
    heldOut: {
      ...group(zinc),
      darkerSkin: group(zinc.filter((c) => c.ita === "Brown" || c.ita === "Tan")),
      benchmark: group(zinc.filter((c) => c.formulation.includes("Benchmark"))),
    },
  };
}

/** GET /api/label-model: 200 LabelModelPayload. Static: it changes only with a new build. */
export function makeLabelModelHandler(build: () => LabelModelPayload = labelModelPayload): () => Promise<Response> {
  return async () => Response.json(build());
}
