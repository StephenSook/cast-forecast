import { z } from "zod";
import { GATES_README } from "@/data/gates/readme.generated";
import k1bJson from "@/data/gates/k1b-results.json";

export type GateRow = {
  gate: string;
  question: string;
  rule: string;
  result: string;
  verdict: "PASS" | "FAIL" | "OTHER";
  links: { text: string; href: string }[];
};

export function githubDocUrl(rel: string): string {
  return "https://github.com/StephenSook/cast-forecast/blob/main/docs/gates/" + rel;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function linksIn(cell: string): { text: string; href: string }[] {
  return [...cell.matchAll(LINK)].map((m) => ({
    text: m[1],
    href: /^[a-z][a-z0-9+.-]*:/i.test(m[2]) ? m[2] : githubDocUrl(m[2]),
  }));
}

function verdictOf(result: string): GateRow["verdict"] {
  const first = result.trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9]+$/, "").toUpperCase();
  return first === "PASS" || first === "FAIL" ? first : "OTHER";
}

/** Reads the pipe rows after the header separator of the gates table. */
export function parseGatesTable(md: string): GateRow[] {
  const lines = md.split("\n").map((l) => l.trim());
  const sep = lines.findIndex((l) => /^\|\s*:?-{3,}/.test(l));
  if (sep < 0) return [];
  const rows: GateRow[] = [];
  for (const line of lines.slice(sep + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const [gate, question, rule, result] = cells;
    rows.push({ gate, question, rule, result, verdict: verdictOf(result), links: [...linksIn(rule), ...linksIn(result)] });
  }
  return rows;
}

export function loadGates(): GateRow[] {
  return parseGatesTable(GATES_README);
}

const K1bFile = z.object({
  k1b_pass: z.boolean(),
  fit: z.object({ r2: z.number(), n_fitted: z.number(), g: z.record(z.string(), z.number()) }),
  g100: z.number(),
  inverse_gating_de00: z.number(),
  thresholds: z.object({ inverse_de_max: z.number() }),
  units_spent: z.number(),
  inverse_plan: z.array(
    z.object({ target_alpha: z.number(), colorIntensity: z.number(), predicted_alpha: z.number() }),
  ),
});

export type K1bSummary = {
  pass: boolean;
  r2: number;
  nFitted: number;
  g: ReadonlyMap<number, number>;
  g100: number;
  inverseGatingDe00: number;
  inverseDeMax: number;
  unitsSpent: number;
  inversePlan: { targetAlpha: number; colorIntensity: number; predictedAlpha: number }[];
};

function summarize(raw: unknown): K1bSummary {
  const k = K1bFile.parse(raw);
  const g = new Map(
    Object.entries(k.fit.g)
      .map(([key, v]): [number, number] => [Number(key), v])
      .sort((a, b) => a[0] - b[0]),
  );
  return {
    pass: k.k1b_pass,
    r2: k.fit.r2,
    nFitted: k.fit.n_fitted,
    g,
    g100: k.g100,
    inverseGatingDe00: k.inverse_gating_de00,
    inverseDeMax: k.thresholds.inverse_de_max,
    unitsSpent: k.units_spent,
    inversePlan: k.inverse_plan.map((p) => ({
      targetAlpha: p.target_alpha,
      colorIntensity: p.colorIntensity,
      predictedAlpha: p.predicted_alpha,
    })),
  };
}

export const K1B: K1bSummary = summarize(k1bJson);
