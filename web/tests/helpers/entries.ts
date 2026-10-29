import type { Bottle } from "@/lib/catalogue";

/** A fixture entry for tests only. Ids start `test-`, names start `Test entry`. Never import from src. */
export function testEntry(o: Partial<Bottle> = {}): Bottle {
  return {
    id: "test-a",
    name: "Test entry A",
    brand: "Test brand",
    upc: null,
    filter: "mineral",
    tinted: false,
    render: { paletteHex: "#FFFFFF", blend: 0.169, errorL: 0.4 },
    whitening: { value: 2.4, low: 1.9, high: 2.9, unit: "L*" },
    evidence: { source: "fda-label", setId: "00000000-0000-4000-8000-000000000001", labelEffective: "2026-10-27", zincOxidePct: 20 },
    ...o,
  };
}

export function catalogueFile(bottles: unknown[]): { schemaVersion: 1; bottles: unknown[] } {
  return { schemaVersion: 1, bottles };
}
