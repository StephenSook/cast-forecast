import { expect, test } from "vitest";
import bottlesJson from "@/data/bottles.json";
import { CATALOGUE, formatWhitening, loadCatalogue, whiteningDomain } from "@/lib/catalogue";
import { catalogueFile, testEntry } from "../helpers/entries";

test("shipped catalogue is version 1, empty, and parses", () => {
  expect(bottlesJson.schemaVersion).toBe(1);
  expect(loadCatalogue(bottlesJson)).toEqual([]);
});
test("loadCatalogue rejects another schemaVersion", () => expect(() => loadCatalogue({ schemaVersion: 2, bottles: [] })).toThrow());
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
