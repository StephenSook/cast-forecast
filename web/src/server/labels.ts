import "server-only";
import { z } from "zod";
import labelsJson from "@/data/labels.json";
import { type Bottle, CATALOGUE, findBottle, loadCatalogueFile } from "@/lib/catalogue";
import { searchEntries } from "@/lib/search";
import { normalizeUpc, upcIndex } from "@/lib/upc";

/**
 * The full catalogue: every kept FDA label (castforecast/label_catalogue.py writes src/data/labels.json). Only the
 * server reads it; the browser gets the featured short list (src/data/bottles.json) and asks /api/labels for the rest.
 */
export const LABELS: readonly Bottle[] = loadCatalogueFile(labelsJson).bottles;

const Count = z.number().int().min(0);
/** How many labels each category rule left out (data/bottles/fda_labels.json counts), for the evidence page. */
export const LEFT_OUT = z
  .object({ tinted: Count, powder: Count, lip: Count, render_error: Count })
  .parse((labelsJson as { leftOut?: unknown }).leftOut);

// The chips and the server must agree: every featured bottle is in the full catalogue, entry for entry.
for (const b of CATALOGUE) {
  if (JSON.stringify(findBottle(b.id, LABELS)) !== JSON.stringify(b)) throw new Error(`featured bottle ${b.id} differs from labels.json`);
}

const BY_UPC = upcIndex(LABELS);

export function findLabel(id: string): Bottle | undefined {
  return findBottle(id, LABELS);
}

/** The one label whose openFDA barcodes include `code` (UPC-A, EAN-13, GTIN-14 or UPC-E), or undefined. */
export function labelByUpc(code: string): Bottle | undefined {
  const norm = normalizeUpc(code);
  const id = norm ? BY_UPC.get(norm) : undefined;
  return id ? findLabel(id) : undefined;
}

/** Where a scanned barcode leads: that label's page, on the shopper's tone when one was picked; null for no label. */
export function scanTarget(code: string, tone: number | null): string | null {
  const b = labelByUpc(code);
  return b ? `/bottle/${b.id}${tone === null ? "" : `?tone=${tone}`}` : null;
}

/** Most results /api/labels returns for one query. */
export const SEARCH_LIMIT = 8;

export function searchLabels(query: string, limit = SEARCH_LIMIT): { total: number; items: Bottle[] } {
  return searchEntries(LABELS, query, limit);
}
