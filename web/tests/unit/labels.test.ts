import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CATALOGUE, RENDER_MAX_ERROR_L } from "@/lib/catalogue";
import { colorIntensityForBlend } from "@/lib/curve";
import { LABELS, LEFT_OUT, findLabel, labelByUpc, scanTarget, searchLabels } from "@/server/labels";

// The real committed catalogue (castforecast/label_catalogue.py), not a fixture.
const counts = JSON.parse(readFileSync("../data/bottles/fda_labels.json", "utf8")).counts;

test("the server holds every kept label, the chips are the featured ones, entry for entry", () => {
  expect(LABELS.length).toBe(counts.kept);
  expect(LABELS.length).toBeGreaterThan(CATALOGUE.length);
  expect(LABELS.filter((b) => b.featured).map((b) => b.id)).toEqual(CATALOGUE.map((b) => b.id));
  for (const b of CATALOGUE) expect(findLabel(b.id)).toEqual(b);
  expect(new Set(LABELS.map((b) => b.id)).size).toBe(LABELS.length);
});

test("the left-out counts are the data file's", () => {
  expect(LEFT_OUT).toEqual({ tinted: counts.tinted, powder: counts.powder, lip: counts.lip, zinc_too_low: counts.zinc_too_low, render_error: counts.render_error });
});

test("no label the server holds predicts a negative cast on any tone", () => {
  expect(counts.zinc_too_low).toBeGreaterThan(0); // the rule that keeps them out is live
  for (const b of LABELS) {
    expect(b.whitening.value, b.id).toBeGreaterThanOrEqual(0);
    for (const t of b.tones) expect(t.whitening.value, `${b.id} L* ${t.lStar}`).toBeGreaterThanOrEqual(0);
  }
});

test("every label renders on at least one tone, within the bound the render route enforces", () => {
  for (const b of LABELS) {
    const ok = b.tones.filter((t) => t.render && t.render.errorL <= RENDER_MAX_ERROR_L && colorIntensityForBlend(t.render.blend).reachable);
    expect(ok.length, b.id).toBeGreaterThan(0);
  }
});

test("a real barcode finds its label in any form a scanner reads it", () => {
  expect(labelByUpc("816218029890")?.id).toBe("supergoop-mineral-sheer-stick"); // UPC-A
  expect(labelByUpc("0634084471724")?.id).toBe("badger-face-mineral"); // EAN-13
  expect(labelByUpc("00086800110804")?.id).toBe("neutrogena-sheer-zinc"); // GTIN-14
  expect(labelByUpc("099482551100")?.id).toBe("365-whole-foods-market-mineral-1f8387be"); // not a chip
  expect(labelByUpc("0303162059306")?.id).toBe("blue-lizard-sheer-sunscreen-3368f1cb");
});

test("a barcode two labels list equally, or no label lists, finds nothing", () => {
  // openFDA lists 0086800102748 on two kept Neutrogena labels, each as its only barcode.
  expect(labelByUpc("0086800102748")).toBeUndefined();
  expect(labelByUpc("000000000000")).toBeUndefined();
  expect(labelByUpc("not a code")).toBeUndefined();
});

test("a sister product's barcode opens the sister product, not the chip or a family label", () => {
  // The Coppertone Pure and Simple spray label (b6492438) also lists the Waterbabies, Baby and Kids barcodes; each of
  // those is the only barcode on its own label, which is the one it opens.
  expect(labelByUpc("0072140028800")?.id).toBe("coppertone-waterbabies-pure-and-simple-sunscreen-0806bdb9");
  expect(labelByUpc("0072140028824")?.id).toBe("coppertone-pure-and-simple-kids-sunscreen-09a97e3f");
  expect(findLabel("coppertone-pure-and-simple")?.upcs).not.toContain("0072140028800");
});

// Codex review of PR #19: a lotion was merged into its line's aerosol for an equal zinc percent, so the lotion's
// barcode opened the aerosol's page and DailyMed label. One line's lotion, spray and stick are separate bottles.
test("one line's lotion, aerosol and stick barcodes each open their own label", () => {
  const cases: [string, string, string][] = [
    ["0072140028718", "coppertone-pure-and-simple-baby-sunscreen-lotion-08134b95", "08134b95"],
    ["0072140028817", "coppertone-pure-and-simple-baby-sunscreen-spray-088b7152", "088b7152"],
    ["0086800112921", "neutrogena-sheer-zinc-kids-mineral-sunscreen-stick-4504a10d", "4504a10d"],
    ["0086800112945", "neutrogena-sheer-zinc-kids-mineral-sunscreen-lotion-c914c4cd", "c914c4cd"],
  ];
  for (const [code, id, setId] of cases) {
    const b = labelByUpc(code);
    expect(b?.id, code).toBe(id);
    expect(b!.evidence.setId.startsWith(setId), code).toBe(true); // its own DailyMed label
  }
  // Same line, same zinc, two forms: two names a shopper can tell apart.
  expect(findLabel(cases[0][1])!.name).toBe("Coppertone Pure and Simple Baby Sunscreen Lotion");
  expect(findLabel(cases[1][1])!.name).toBe("Coppertone Pure and Simple Baby Sunscreen Spray");
});

test("a scan opens the bottle page, on the tone when one was picked", () => {
  expect(scanTarget("816218029890", 45)).toBe("/bottle/supergoop-mineral-sheer-stick?tone=45");
  expect(scanTarget("816218029890", null)).toBe("/bottle/supergoop-mineral-sheer-stick");
  expect(scanTarget("000000000000", 45)).toBeNull();
});

test("searching the full catalogue finds labels that are not chips", () => {
  const r = searchLabels("blue lizard");
  expect(r.total).toBeGreaterThanOrEqual(3);
  expect(r.items.every((b) => /blue lizard/i.test(`${b.name} ${b.brand}`))).toBe(true);
  expect(r.items.some((b) => !b.featured)).toBe(true);
  expect(searchLabels("mineral").items.length).toBe(8);
});
