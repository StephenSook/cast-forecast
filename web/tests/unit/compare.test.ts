import { expect, test } from "vitest";
import { COMPARE_PAGE_SIZE, comparePage, compareRows, dateInWords, evidenceLine, rowLabel } from "@/lib/compare";
import { TEST_TONES, testEntry } from "../helpers/entries";

test("an empty catalogue gives no rows and no problem", () => {
  expect(compareRows([])).toEqual({ rows: [], unit: null, problem: null });
});

test("rows carry the name, value and interval from the entry, least cast first, each linking to its bottle", () => {
  const b = testEntry({ id: "test-b", name: "Test entry B", whitening: { value: 4, low: 3, high: 5, unit: "L*" } });
  const r = compareRows([b, testEntry()]);
  expect(r.unit).toBe("L*");
  expect(r.problem).toBeNull();
  // Names already lead with the brand, so the brand is not repeated.
  expect(r.rows).toEqual([
    { label: "Test entry A", value: 2.4, low: 1.9, high: 2.9, href: "/bottle/test-a" },
    { label: "Test entry B", value: 4, low: 3, high: 5, href: "/bottle/test-b" },
  ]);
});

test("with a tone, rows show that tone's numbers and sort by them", () => {
  const tones = (v45: number) => TEST_TONES.map((t) => ({ lStar: t.lStar, whitening: { value: t.lStar === 45 ? v45 : 1, low: 0, high: 9, unit: "L*" }, render: null }));
  const a = testEntry({ tones: tones(6) });
  const b = testEntry({ id: "test-b", name: "Test entry B", tones: tones(3) });
  expect(compareRows([a, b], 45).rows.map((r) => [r.label, r.value])).toEqual([["Test entry B", 3], ["Test entry A", 6]]);
  expect(compareRows([a], 40).rows).toEqual([]); // a tone the entry does not list is not drawn
});

test("a row names its brand once: only when the name does not already hold it", () => {
  expect(rowLabel({ name: "Coppertone Pure and Simple", brand: "Coppertone" })).toBe("Coppertone Pure and Simple");
  expect(rowLabel({ name: "Mineral Sunscreen", brand: "Walgreen" })).toBe("Mineral Sunscreen, Walgreen");
  expect(rowLabel({ name: "Naked Bee Mineral", brand: "The Naked Bee" })).toBe("Naked Bee Mineral");
  expect(rowLabel({ name: "Weathered Mineral", brand: "The Sun Co" })).toBe("Weathered Mineral, The Sun Co");
});

test("two rows that would read the same are told apart by their zinc percent", () => {
  const ev = (pct: number, n: number) => ({ source: "fda-label" as const, setId: `00000000-0000-4000-8000-00000000000${n}`, labelEffective: "2026-01-01", zincOxidePct: pct });
  const rows = compareRows([
    testEntry({ id: "test-a", name: "Test Sensitive", brand: "Test", evidence: ev(24, 1) }),
    testEntry({ id: "test-b", name: "Test Sensitive", brand: "Test", evidence: ev(20, 2) }),
    testEntry({ id: "test-c", name: "Test Sport", brand: "Test", evidence: ev(20, 3) }),
  ]).rows.map((r) => r.label);
  expect(rows).toEqual(["Test Sensitive (24% zinc oxide)", "Test Sensitive (20% zinc oxide)", "Test Sport"]);
});

test("compare pages: a search narrows the rows, pages hold COMPARE_PAGE_SIZE, and a page past the end is the last", () => {
  const list = Array.from({ length: COMPARE_PAGE_SIZE + 3 }, (_, i) =>
    testEntry({ id: `test-${i}`, name: `Test entry ${i}`, whitening: { value: i, low: i - 1, high: i + 1, unit: "L*" } }),
  );
  const first = comparePage(list, 55, "", 1);
  expect([first.total, first.page, first.pages, first.rows.length]).toEqual([COMPARE_PAGE_SIZE + 3, 1, 2, COMPARE_PAGE_SIZE]);
  const last = comparePage(list, 55, "", 99);
  expect([last.page, last.rows.length]).toEqual([2, 3]);
  expect(comparePage(list, 55, "", Number.NaN).page).toBe(1);
  const found = comparePage(list, 55, "entry 2", 1);
  expect(found.rows.map((r) => r.label)).toEqual(["Test entry 2", "Test entry 20", "Test entry 21", "Test entry 22", "Test entry 23", "Test entry 24", "Test entry 25", "Test entry 26", "Test entry 27"]);
  expect(comparePage(list, 55, "nothing like it", 1)).toMatchObject({ total: 0, rows: [], page: 1, pages: 1 });
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

test("the evidence line for a tone uses that tone's numbers; an unlisted tone falls back to L* 55", () => {
  const tones = TEST_TONES.map((t) => ({ lStar: t.lStar, whitening: { value: t.lStar / 10, low: 1, high: 8, unit: "L*" }, render: null }));
  const b = testEntry({ tones });
  expect(evidenceLine(b, 45)).toContain("for skin of L* 45. Range 1.0 to 8.0 L*");
  expect(evidenceLine(b, 40)).toContain("for skin of L* 55. Range 1.9 to 2.9 L*");
});
