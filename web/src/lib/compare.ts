import type { Bottle } from "@/lib/catalogue";
import type { BarRow } from "@/ui/Bars";

/** The /compare bar rows, read from the catalogue entries. One axis means one unit, so mixed units are a problem. */
export function compareRows(bottles: readonly Bottle[]): { rows: BarRow[]; unit: string | null; problem: string | null } {
  const units = new Set(bottles.map((b) => b.whitening.unit));
  return {
    rows: bottles.map((b) => ({ label: `${b.brand} ${b.name}`, value: b.whitening.value, low: b.whitening.low, high: b.whitening.high })),
    unit: bottles.length > 0 ? bottles[0].whitening.unit : null,
    problem: units.size > 1 ? `mixed units: ${[...units].join(", ")}` : null,
  };
}
