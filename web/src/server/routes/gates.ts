import "server-only";
import { colorIntensityForBlend } from "@/lib/curve";
import { type GateRow, K1B, loadGates } from "@/lib/gates";
import { RELEASE } from "@/lib/release";

export type GatesPayload = {
  release: string;
  gates: GateRow[];
  k1b: {
    pass: boolean;
    r2: number;
    g: [number, number][];
    g100: number;
    inverseGatingDe00: number;
    unitsSpent: number;
    inverseCheck: { target: number; recorded: number; recomputed: number; match: boolean }[];
  };
};

/**
 * The gates table and the K1b summary. `inverseCheck` recomputes each recorded inverse-plan intensity from the curve
 * this app renders with, so a reader can see the shipped inverse agrees with the recorded run.
 */
export function gatesPayload(): GatesPayload {
  return {
    release: RELEASE,
    gates: loadGates(),
    k1b: {
      pass: K1B.pass,
      r2: K1B.r2,
      g: [...K1B.g.entries()],
      g100: K1B.g100,
      inverseGatingDe00: K1B.inverseGatingDe00,
      unitsSpent: K1B.unitsSpent,
      inverseCheck: K1B.inversePlan.map((p) => {
        const recomputed = colorIntensityForBlend(p.targetAlpha).colorIntensity;
        return { target: p.targetAlpha, recorded: p.colorIntensity, recomputed, match: recomputed === p.colorIntensity };
      }),
    },
  };
}

/** GET /api/gates: 200 GatesPayload. Static: it changes only with a new build. */
export function makeGatesHandler(build: () => GatesPayload = gatesPayload): () => Promise<Response> {
  return async () => Response.json(build());
}
