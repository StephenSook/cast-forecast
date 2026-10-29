import { type Bottle, toneOf } from "@/lib/catalogue";
import { foldText, searchEntries } from "@/lib/search";
import type { BarRow } from "@/ui/Bars";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** An ISO date (YYYY-MM-DD) in words, which wraps at spaces instead of inside the date on a phone. */
export function dateInWords(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The line under a bottle's number, read from its entry: where the prediction comes from and how far it can miss.
 * `lStar` picks the tone (one the entry lists); without it, the entry's own number for skin of L* 55.
 */
export function evidenceLine(b: Bottle, lStar?: number): string {
  const tone = lStar === undefined ? undefined : toneOf(b, lStar);
  const w = tone?.whitening ?? b.whitening;
  const e = b.evidence;
  return `Predicted from the label's ${e.zincOxidePct}% zinc oxide (FDA label of ${dateInWords(e.labelEffective)}) for skin of L* ${tone?.lStar ?? 55}. Range ${w.low.toFixed(1)} to ${w.high.toFixed(1)} ${w.unit}, the model's typical miss on a product it was not fitted on.`;
}

const SMALL = new Set(["a", "an", "and", "by", "for", "of", "the"]);

/**
 * A row label for lists where names repeat ("Mineral Sunscreen" from many labelers): the name, with the brand added
 * only when the name does not already hold the brand's first real word, so no row names its brand twice.
 */
export function rowLabel(b: Pick<Bottle, "name" | "brand">): string {
  const first = foldText(b.brand)
    .split(" ")
    .find((w) => w && !SMALL.has(w));
  return !first || ` ${foldText(b.name)} `.includes(` ${first} `) ? b.name : `${b.name}, ${b.brand}`;
}

/** The whitening a row shows: the tone's when `lStar` is given (and the entry lists it), else the entry's own (L* 55). */
function shown(b: Bottle, lStar?: number): Bottle["whitening"] | undefined {
  return lStar === undefined ? b.whitening : toneOf(b, lStar)?.whitening;
}

/**
 * The /compare bar rows, read from the catalogue entries, least cast first (ties by name). Each label is the bottle's
 * name, with its brand only when the name does not already lead with it. One axis means one unit, so mixed units are a
 * problem. With `lStar`, the numbers are that tone's, and a bottle that does not list the tone is not drawn.
 */
export function compareRows(bottles: readonly Bottle[], lStar?: number): { rows: BarRow[]; unit: string | null; problem: string | null } {
  const drawn = bottles.flatMap((b) => {
    const w = shown(b, lStar);
    return w ? [{ b, w }] : [];
  });
  const units = new Set(drawn.map((d) => d.w.unit));
  // Two labels from one brand can share a name at different percents; the percent then tells the rows apart.
  const seen = new Map<string, number>();
  for (const { b } of drawn) seen.set(rowLabel(b), (seen.get(rowLabel(b)) ?? 0) + 1);
  const label = (b: Bottle) => (seen.get(rowLabel(b))! > 1 ? `${rowLabel(b)} (${b.evidence.zincOxidePct}% zinc oxide)` : rowLabel(b));
  return {
    rows: drawn
      .sort((x, y) => x.w.value - y.w.value || x.b.name.localeCompare(y.b.name) || x.b.id.localeCompare(y.b.id))
      .map(({ b, w }) => ({ label: label(b), value: w.value, low: w.low, high: w.high, href: `/bottle/${b.id}` })),
    unit: drawn.length > 0 ? drawn[0].w.unit : null,
    problem: units.size > 1 ? `mixed units: ${[...units].join(", ")}` : null,
  };
}

/** Rows per /compare page. */
export const COMPARE_PAGE_SIZE = 25;

/**
 * One page of /compare: the bottles matching `query` (every bottle when it is empty), least cast first on the tone of
 * L* `lStar`. `page` is clamped to the pages there are; `total` counts every matching row.
 */
export function comparePage(
  bottles: readonly Bottle[],
  lStar: number,
  query: string,
  page: number,
): { rows: BarRow[]; unit: string | null; problem: string | null; total: number; page: number; pages: number } {
  const matches = foldText(query) ? searchEntries(bottles, query, bottles.length).items : bottles;
  const all = compareRows(matches, lStar);
  const pages = Math.max(1, Math.ceil(all.rows.length / COMPARE_PAGE_SIZE));
  const at = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  return { ...all, rows: all.rows.slice((at - 1) * COMPARE_PAGE_SIZE, at * COMPARE_PAGE_SIZE), total: all.rows.length, page: at, pages };
}
