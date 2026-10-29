import { expect, test } from "vitest";
import { foldText, searchEntries } from "@/lib/search";

const list = [
  { id: "a", name: "Coppertone Pure and Simple", brand: "Coppertone", featured: true },
  { id: "b", name: "Coppertone Sport Mineral Sunscreen", brand: "Beiersdorf" },
  { id: "c", name: "Mineral Sunscreen", brand: "Walgreen" },
  { id: "d", name: "Babo Botanicals Sheer Zinc", brand: "Babo Botanicals" },
  { id: "e", name: "Crème Solaire Minéral", brand: "Évian Labs" },
  { id: "f", name: "Kids Mineral Sunscreen", brand: "Coppertone" },
];
const ids = (q: string, limit = 10) => searchEntries(list, q, limit).items.map((e) => e.id);

test("folding drops case, accents and punctuation", () => {
  expect(foldText("  Crème  Solaire® (SPF-free) ")).toBe("creme solaire spf free");
});

test("every word must start a word of the name or brand", () => {
  expect(ids("mineral")).toEqual(["c", "b", "e", "f"]); // c starts with it; the rest by name
  expect(ids("walgreen min")).toEqual(["c"]);
  expect(ids("neral")).toEqual([]); // inside a word, not at its start
  expect(ids("creme")).toEqual(["e"]);
  expect(ids("evian")).toEqual(["e"]); // the brand counts too
});

test("names that start with the query come first, then names holding its first word, then a brand match", () => {
  // f matches through its brand only (Coppertone), so it comes after the two names that hold the word.
  expect(ids("coppertone")).toEqual(["a", "b", "f"]);
});

test("a query with no letters or digits matches nothing, and the limit keeps the total", () => {
  expect(searchEntries(list, " %% ", 5)).toEqual({ total: 0, items: [] });
  const r = searchEntries(list, "mineral", 2);
  expect(r.total).toBe(4);
  expect(r.items.map((e) => e.id)).toEqual(["c", "b"]);
});
