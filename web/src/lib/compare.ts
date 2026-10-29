import type { Bottle } from "@/lib/catalogue";
import type { BarRow } from "@/ui/Bars";

/** The line under a bottle's number, read from its entry: where the prediction comes from and how far it can miss. */
export function evidenceLine(b: Bottle): string {
  const { whitening: w, evidence: e } = b;
  return `Predicted from the label's ${e.zincOxidePct}% zinc oxide (FDA label of ${e.labelEffective}) for skin of L* 55. Range ${w.low.toFixed(1)} to ${w.high.toFixed(1)} ${w.unit}, the model's typical miss on a product it was not fitted on.`;
}

/** The /compare bar rows, read from the catalogue entries. One axis means one unit, so mixed units are a problem. */
export function compareRows(bottles: readonly Bottle[]): { rows: BarRow[]; unit: string | null; problem: string | null } {
  const units = new Set(bottles.map((b) => b.whitening.unit));
  return {
    rows: bottles.map((b) => ({ label: `${b.brand} ${b.name}`, value: b.whitening.value, low: b.whitening.low, high: b.whitening.high })),
    unit: bottles.length > 0 ? bottles[0].whitening.unit : null,
    problem: units.size > 1 ? `mixed units: ${[...units].join(", ")}` : null,
  };
}
