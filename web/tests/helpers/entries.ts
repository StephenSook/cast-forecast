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
    render: { paletteHex: "#FFFFFF", blend: 0.169 },
    whitening: { value: 2.4, low: 1.9, high: 2.9, unit: "L*" },
    evidence: { csvRowId: "test-row-1", measuredAt: "2026-10-27", photos: 3 },
    ...o,
  };
}

export function catalogueFile(bottles: unknown[]): { schemaVersion: 1; bottles: unknown[] } {
  return { schemaVersion: 1, bottles };
}
