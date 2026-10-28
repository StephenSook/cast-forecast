import { expect, test } from "vitest";
import { compareRows, measuredLine } from "@/lib/compare";
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

test("the measured line is singular for one photo", () => {
  expect(measuredLine(testEntry({ evidence: { csvRowId: "r", measuredAt: "2026-10-27", photos: 1 } }))).toBe("Range 1.9 to 2.9 L*, from 1 photo measured 2026-10-27.");
  expect(measuredLine(testEntry())).toBe("Range 1.9 to 2.9 L*, from 3 photos measured 2026-10-27.");
});
