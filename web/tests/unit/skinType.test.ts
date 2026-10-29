import { expect, test } from "vitest";
import { TONES } from "@/lib/catalogue";
import { FITZPATRICK, type Fitzpatrick, SUGGESTED_TONE, isFitzpatrick } from "@/lib/skinType";

// The tones' b*, as castforecast/label_catalogue.py builds them (Lab with a* 14, b* 18).
const B_STAR = 18;
const ita = (lStar: number) => (Math.atan2(lStar - 50, B_STAR) * 180) / Math.PI;
// ITA° colour classes, lighter first (Del Bino et al. 2006, PMID 17083487), paired in order with types I to VI.
const CLASSES: [Fitzpatrick, number, number][] = [
  ["I", 55, 90], ["II", 41, 55], ["III", 28, 41], ["IV", 10, 28], ["V", -30, 10], ["VI", -90, -30],
];

test("the suggestion table follows its stated rule from the ITA classes and the shipped tones", () => {
  const tones = TONES.map((t) => t.lStar);
  const lightest = Math.max(...tones);
  const lowestIta = Math.min(...tones.map(ita));
  for (const [type, lo, hi] of CLASSES) {
    const inside = tones.filter((l) => ita(l) > lo && ita(l) <= hi);
    // A tone inside the class, the deeper one when two are; a class above every tone gets the lightest; one below, none.
    const expected = inside.length > 0 ? Math.min(...inside) : lo >= ita(lightest) ? lightest : hi <= lowestIta ? "deeper" : null;
    expect(expected, type).not.toBeNull();
    expect(SUGGESTED_TONE[type], type).toBe(expected);
  }
});
test("every suggested tone is one the shopper can pick, and deeper types never get a lighter tone", () => {
  const tones = new Set(TONES.map((t) => t.lStar));
  const values = FITZPATRICK.map((t) => SUGGESTED_TONE[t]);
  for (const v of values) if (v !== "deeper") expect(tones.has(v)).toBe(true);
  const numeric = values.filter((v): v is number => v !== "deeper");
  expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
  expect(values.at(-1)).toBe("deeper");
});
test("isFitzpatrick accepts exactly I to VI", () => {
  for (const t of FITZPATRICK) expect(isFitzpatrick(t)).toBe(true);
  for (const v of ["i", "VII", "", " IV", 4, null, undefined, ["IV"]]) expect(isFitzpatrick(v)).toBe(false);
});
