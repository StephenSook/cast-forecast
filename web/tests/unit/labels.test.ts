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
  expect(LEFT_OUT).toEqual({ tinted: counts.tinted, powder: counts.powder, lip: counts.lip, render_error: counts.render_error });
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

test("a barcode two labels list, or no label lists, finds nothing", () => {
  // openFDA lists 0086800102748 on two kept Neutrogena labels, each as its own.
  expect(labelByUpc("0086800102748")).toBeUndefined();
  expect(labelByUpc("000000000000")).toBeUndefined();
  expect(labelByUpc("not a code")).toBeUndefined();
});

test("a sister product's barcode that an older duplicate listed opens the sister product, not the chip", () => {
  // An older Coppertone Pure and Simple label listed the Waterbabies barcode; the Waterbabies label lists it as its own.
  expect(labelByUpc("0072140028800")?.id).toBe("coppertone-waterbabies-pure-and-simple-sunscreen-0806bdb9");
  expect(findLabel("coppertone-pure-and-simple")?.upcs).not.toContain("0072140028800");
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
