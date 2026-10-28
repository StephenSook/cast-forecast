import { z } from "zod";
import bottlesJson from "@/data/bottles.json";

export const CATALOGUE_SCHEMA_VERSION = 1;

export const BottleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1).max(80),
  brand: z.string().min(1).max(60),
  upc: z.string().regex(/^\d{8,14}$/).nullable(),
  filter: z.enum(["mineral", "chemical"]),
  tinted: z.boolean(),
  render: z.object({
    paletteHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    blend: z.number().min(0).max(1),
  }),
  whitening: z
    .object({
      value: z.number(),
      low: z.number(),
      high: z.number(),
      unit: z.string().min(1).max(12),
    })
    .refine((w) => w.low <= w.value && w.value <= w.high, { message: "whitening needs low <= value <= high" }),
  evidence: z.object({
    csvRowId: z.string().min(1),
    measuredAt: z.iso.date(),
    photos: z.number().int().min(1),
  }),
});

export type Bottle = z.infer<typeof BottleSchema>;

export const CatalogueFileSchema = z.object({
  schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
  bottles: z.array(BottleSchema),
});

/** Parses the whole versioned file object. Throws on another version, a bare array, a bad entry or a duplicate id. */
export function loadCatalogue(raw: unknown): Bottle[] {
  const { bottles } = CatalogueFileSchema.parse(raw);
  const seen = new Set<string>();
  for (const b of bottles) {
    if (seen.has(b.id)) throw new Error(`duplicate bottle id: ${b.id}`);
    seen.add(b.id);
  }
  return bottles;
}

export const CATALOGUE: readonly Bottle[] = loadCatalogue(bottlesJson);

export function findBottle(id: string, list: readonly Bottle[] = CATALOGUE): Bottle | undefined {
  return list.find((b) => b.id === id);
}

export function whiteningDomain(list: readonly Bottle[]): readonly [number, number] {
  if (list.length === 0) return [0, 1];
  return [0, Math.ceil(Math.max(...list.map((b) => b.whitening.high)))];
}

export function formatWhitening(b: Bottle): string {
  const { value, unit } = b.whitening;
  const text = value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${text} ${unit}`;
}
