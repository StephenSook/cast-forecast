import { z } from "zod";
import bottlesJson from "@/data/bottles.json";

export const CATALOGUE_SCHEMA_VERSION = 2;

/** Largest L* gap, for a tone, between a bottle's render as sent and its predicted whitening (castforecast/label_catalogue.py). */
export const RENDER_MAX_ERROR_L = 1.0;

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

const WhiteningSchema = z
  .object({
    value: z.number(),
    low: z.number(),
    high: z.number(),
    unit: z.string().min(1).max(12),
  })
  .refine((w) => w.low <= w.value && w.value <= w.high, { message: "whitening needs low <= value <= high" });

const RenderSchema = z.object({ paletteHex: Hex, blend: z.number().min(0).max(1), errorL: z.number().min(0) });

/** One skin tone a shopper can pick: its L* and the swatch shown for it. */
export const ToneSchema = z.object({ lStar: z.number().min(0).max(100), hex: Hex });

export const BottleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1).max(80),
  brand: z.string().min(1).max(60),
  upc: z.string().regex(/^\d{8,14}$/).nullable(),
  filter: z.enum(["mineral", "chemical"]),
  tinted: z.boolean(),
  /** The middle tone's prediction, where one number per bottle is shown. */
  whitening: WhiteningSchema,
  /** Per tone: the prediction, and the render as the route sends it (null when no render is close enough). */
  tones: z.array(z.object({ lStar: z.number(), whitening: WhiteningSchema, render: RenderSchema.nullable() })).min(1),
  evidence: z.object({
    source: z.literal("fda-label"),
    setId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    labelEffective: z.iso.date(),
    zincOxidePct: z.number().gt(0).max(25),
  }),
});

export type Bottle = z.infer<typeof BottleSchema>;
export type Tone = z.infer<typeof ToneSchema>;
export type Whitening = Bottle["whitening"];

export const CatalogueFileSchema = z.object({
  schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
  tones: z.array(ToneSchema).min(1),
  bottles: z.array(BottleSchema),
});

/**
 * Parses the whole versioned file object. Throws on another version, a bare array, a bad entry, a duplicate id, or a
 * bottle whose tones are not the file's tones in the same order.
 */
export function loadCatalogueFile(raw: unknown): { tones: Tone[]; bottles: Bottle[] } {
  const { tones, bottles } = CatalogueFileSchema.parse(raw);
  const order = tones.map((t) => t.lStar).join(",");
  const seen = new Set<string>();
  for (const b of bottles) {
    if (seen.has(b.id)) throw new Error(`duplicate bottle id: ${b.id}`);
    seen.add(b.id);
    if (b.tones.map((t) => t.lStar).join(",") !== order) throw new Error(`bottle ${b.id} does not list the file's tones`);
  }
  return { tones, bottles };
}

export function loadCatalogue(raw: unknown): Bottle[] {
  return loadCatalogueFile(raw).bottles;
}

const FILE = loadCatalogueFile(bottlesJson);
export const CATALOGUE: readonly Bottle[] = FILE.bottles;
export const TONES: readonly Tone[] = FILE.tones;

/** The bottle's FDA drug label on DailyMed, where its zinc oxide percentage comes from. */
export function labelUrl(b: Bottle): string {
  return `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${b.evidence.setId}`;
}

export function findBottle(id: string, list: readonly Bottle[] = CATALOGUE): Bottle | undefined {
  return list.find((b) => b.id === id);
}

/** The bottle's entry for a tone, or undefined for a tone it does not list. */
export function toneOf(b: Bottle, lStar: number): Bottle["tones"][number] | undefined {
  return b.tones.find((t) => t.lStar === lStar);
}

/** One axis for every bottle on every tone, so switching tone never rescales the bars. */
export function whiteningDomain(list: readonly Bottle[]): readonly [number, number] {
  if (list.length === 0) return [0, 1];
  return [0, Math.ceil(Math.max(...list.flatMap((b) => [b.whitening.high, ...b.tones.map((t) => t.whitening.high)])))];
}

export function formatValue(w: Pick<Whitening, "value" | "unit">): string {
  return `${w.value >= 0 ? "+" : ""}${w.value.toFixed(1)} ${w.unit}`;
}

export function formatWhitening(b: Bottle): string {
  return formatValue(b.whitening);
}
