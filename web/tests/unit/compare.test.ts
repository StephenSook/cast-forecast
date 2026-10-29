import { expect, test } from "vitest";
import { compareRows, evidenceLine } from "@/lib/compare";
import { testEntry } from "../helpers/entries";

test("an empty catalogue gives no rows and no problem", () => {
  expect(compareRows([])).toEqual({ rows: [], unit: null, problem: null });
});

test("rows carry the label, value and interval from the entry", () => {
  const r = compareRows([testEntry(), testEntry({ id: "test-b", name: "Test entry B", whitening: { value: 4, low: 3, high: 5, unit: "L*" } })]);
  expect(r.unit).toBe("L*");
  expect(r.problem).toBeNull();
  expect(r.rows).toEqual([
    { label: "Test brand Test entry A", value: 2.4, low: 1.9, high: 2.9 },
    { label: "Test brand Test entry B", value: 4, low: 3, high: 5 },
  ]);
});

test("mixed units are a problem, because one axis cannot honestly hold both", () => {
  const r = compareRows([testEntry(), testEntry({ id: "test-b", whitening: { value: 1, low: 0, high: 2, unit: "dE" } })]);
  expect(r.problem).toMatch(/mixed units/);
});

test("the evidence line names the label, the reference skin and the miss range, all read from the entry", () => {
  expect(evidenceLine(testEntry())).toBe(
    "Predicted from the label's 20% zinc oxide (FDA label of 2026-10-27) for skin of L* 55. Range 1.9 to 2.9 L*, the model's typical miss on a product it was not fitted on.",
  );
  const other = testEntry({ evidence: { source: "fda-label", setId: "00000000-0000-4000-8000-000000000002", labelEffective: "2025-02-13", zincOxidePct: 21.6 } });
  expect(evidenceLine(other)).toContain("21.6% zinc oxide (FDA label of 2025-02-13)");
});
