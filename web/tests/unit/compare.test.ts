import { expect, test } from "vitest";
import { compareRows, dateInWords, evidenceLine } from "@/lib/compare";
import { testEntry } from "../helpers/entries";

test("an empty catalogue gives no rows and no problem", () => {
  expect(compareRows([])).toEqual({ rows: [], unit: null, problem: null });
});

test("rows carry the name, value and interval from the entry, least cast first", () => {
  const b = testEntry({ id: "test-b", name: "Test entry B", whitening: { value: 4, low: 3, high: 5, unit: "L*" } });
  const r = compareRows([b, testEntry()]);
  expect(r.unit).toBe("L*");
  expect(r.problem).toBeNull();
  // Names already lead with the brand, so the brand is not repeated.
  expect(r.rows).toEqual([
    { label: "Test entry A", value: 2.4, low: 1.9, high: 2.9 },
    { label: "Test entry B", value: 4, low: 3, high: 5 },
  ]);
});

test("mixed units are a problem, because one axis cannot honestly hold both", () => {
  const r = compareRows([testEntry(), testEntry({ id: "test-b", whitening: { value: 1, low: 0, high: 2, unit: "dE" } })]);
  expect(r.problem).toMatch(/mixed units/);
});

test("the evidence line names the label, the reference skin and the miss range, all read from the entry", () => {
  expect(evidenceLine(testEntry())).toBe(
    "Predicted from the label's 20% zinc oxide (FDA label of October 27, 2026) for skin of L* 55. Range 1.9 to 2.9 L*, the model's typical miss on a product it was not fitted on.",
  );
  const other = testEntry({ evidence: { source: "fda-label", setId: "00000000-0000-4000-8000-000000000002", labelEffective: "2025-02-13", zincOxidePct: 21.6 } });
  expect(evidenceLine(other)).toContain("21.6% zinc oxide (FDA label of February 13, 2025)");
  expect([dateInWords("2023-11-09"), dateInWords("2026-03-31"), dateInWords("2025-01-08")]).toEqual(["November 9, 2023", "March 31, 2026", "January 8, 2025"]);
});
