/** Lower case, accents dropped, every run of other characters one space: "Babo  Botanicals®" -> "babo botanicals". */
export function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Searchable = { id: string; name: string; brand: string; featured?: boolean };

/**
 * Entries whose name and brand hold every word of `query` (each word matching the start of a word there), best first:
 * names that start with the query, then names with a word starting with its first word, then featured bottles, then by
 * name. A query with no letters or digits matches nothing. `total` counts every match; `items` holds the first `limit`.
 */
export function searchEntries<T extends Searchable>(list: readonly T[], query: string, limit: number): { total: number; items: T[] } {
  const q = foldText(query);
  if (!q) return { total: 0, items: [] };
  const words = q.split(" ");
  const scored: { e: T; rank: number; name: string }[] = [];
  for (const e of list) {
    const name = foldText(e.name);
    const hay = ` ${name} ${foldText(e.brand)}`;
    if (!words.every((w) => hay.includes(` ${w}`))) continue;
    const rank = name.startsWith(q) ? 0 : ` ${name}`.includes(` ${words[0]}`) ? 1 : 2;
    scored.push({ e, rank: rank * 2 + (e.featured ? 0 : 1), name });
  }
  scored.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.e.id.localeCompare(b.e.id));
  return { total: scored.length, items: scored.slice(0, limit).map((s) => s.e) };
}
