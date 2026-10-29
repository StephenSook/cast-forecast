import { expect, test } from "vitest";
import bottlesJson from "@/data/bottles.json";
import { CATALOGUE, formatWhitening, labelUrl, loadCatalogue, RENDER_MAX_ERROR_L, whiteningDomain } from "@/lib/catalogue";
import { catalogueFile, testEntry } from "../helpers/entries";

test("shipped catalogue is version 1 and parses; every bottle cites an FDA label and renders within the bound", () => {
  expect(bottlesJson.schemaVersion).toBe(2);
  const bottles = loadCatalogue(bottlesJson);
  expect(bottles.length).toBeGreaterThanOrEqual(5);
  for (const b of bottles) {
    expect(b.evidence.source).toBe("fda-label");
    expect(labelUrl(b)).toBe(`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${b.evidence.setId}`);
    for (const t of b.tones) expect(t.render?.errorL ?? Infinity).toBeLessThanOrEqual(RENDER_MAX_ERROR_L);
  }
});
test("schema rejects a zinc oxide percent above the 25 percent label limit", () =>
  expect(() => loadCatalogue(catalogueFile([testEntry({ evidence: { ...testEntry().evidence, zincOxidePct: 30 } })]))).toThrow());
test("loadCatalogue rejects another schemaVersion", () => expect(() => loadCatalogue({ schemaVersion: 1, tones: [], bottles: [] })).toThrow());
test("loadCatalogue rejects a bottle whose tones are not the file's tones in order", () =>
  expect(() => loadCatalogue(catalogueFile([testEntry({ tones: [...testEntry().tones].reverse() })]))).toThrow(/tones/));
test("loadCatalogue rejects the unversioned bare array", () => expect(() => loadCatalogue([])).toThrow());
test("no shipped id starts with test-", () => expect(CATALOGUE.filter((b) => b.id.startsWith("test-"))).toEqual([]));
test("schema rejects an entry without evidence", () => expect(() => loadCatalogue(catalogueFile([{ ...testEntry(), evidence: undefined }]))).toThrow());
test("schema rejects whitening with low above value", () =>
  expect(() => loadCatalogue(catalogueFile([testEntry({ whitening: { value: 1, low: 2, high: 3, unit: "L*" } })]))).toThrow());
test("loadCatalogue rejects duplicate ids", () => expect(() => loadCatalogue(catalogueFile([testEntry(), testEntry()]))).toThrow(/duplicate/));
test("loadCatalogue accepts a valid entry", () => expect(loadCatalogue(catalogueFile([testEntry()]))).toEqual([testEntry()]));
test("whiteningDomain is [0, 1] when empty and [0, ceil(max high)] otherwise", () => {
  expect(whiteningDomain([])).toEqual([0, 1]);
  expect(whiteningDomain([testEntry()])).toEqual([0, 3]);
});
test("formatWhitening shows sign, one decimal and unit", () => {
  expect(formatWhitening(testEntry())).toBe("+2.4 L*");
  expect(formatWhitening(testEntry({ whitening: { value: -0.5, low: -1, high: 0, unit: "L*" } }))).toBe("-0.5 L*");
});
