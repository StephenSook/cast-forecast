import type { Bottle } from "@/lib/catalogue";
import type { BarRow } from "@/ui/Bars";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** An ISO date (YYYY-MM-DD) in words, which wraps at spaces instead of inside the date on a phone. */
export function dateInWords(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The line under a bottle's number, read from its entry: where the prediction comes from and how far it can miss. */
export function evidenceLine(b: Bottle): string {
  const { whitening: w, evidence: e } = b;
  return `Predicted from the label's ${e.zincOxidePct}% zinc oxide (FDA label of ${dateInWords(e.labelEffective)}) for skin of L* 55. Range ${w.low.toFixed(1)} to ${w.high.toFixed(1)} ${w.unit}, the model's typical miss on a product it was not fitted on.`;
}

/**
 * The /compare bar rows, read from the catalogue entries, least cast first. Labels are the bottle names, which already
 * lead with the brand. One axis means one unit, so mixed units are a problem.
 */
export function compareRows(bottles: readonly Bottle[]): { rows: BarRow[]; unit: string | null; problem: string | null } {
  const units = new Set(bottles.map((b) => b.whitening.unit));
  return {
    rows: [...bottles]
      .sort((a, b) => a.whitening.value - b.whitening.value)
      .map((b) => ({ label: b.name, value: b.whitening.value, low: b.whitening.low, high: b.whitening.high })),
    unit: bottles.length > 0 ? bottles[0].whitening.unit : null,
    problem: units.size > 1 ? `mixed units: ${[...units].join(", ")}` : null,
  };
}
