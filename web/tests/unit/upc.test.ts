import { expect, test } from "vitest";
import { normalizeUpc, upcEToA, upcIndex } from "@/lib/upc";

test("every barcode form reads as the 13 digits openFDA lists", () => {
  // Supergoop Mineral Sheer Stick's openFDA UPC, 0816218029890, as a scanner can return it.
  for (const raw of ["816218029890", "0816218029890", "00816218029890", "8162 1802 9890", "816218-029890"]) {
    expect(normalizeUpc(raw), raw).toBe("0816218029890");
  }
});

test("UPC-E expands to its UPC-A, for each of the four expansion rules", () => {
  expect(upcEToA("04252614")).toBe("042100005264"); // last digit 0 to 2
  expect(upcEToA("01234531")).toBe("012300000451"); // 3
  expect(upcEToA("01234542")).toBe("012340000052"); // 4
  expect(upcEToA("01234576")).toBe("012345000076"); // 5 to 9
  expect(normalizeUpc("04252614")).toBe("0042100005264");
  expect(upcEToA("24252614")).toBeNull(); // number system 2 has no UPC-E
});

test("anything that is not a barcode reads as null: wrong check digit, all zeros, wrong length, letters", () => {
  for (const raw of ["0816218029891", "816218029899", "0000000000000", "000000000000", "", "abc", "12345", "123456789", "12345678901",
    "10816218029890", "081621802989x", "123456789012345"]) {
    expect(normalizeUpc(raw), raw).toBeNull();
  }
});

test("the index finds an entry by any of its barcodes, and a barcode two entries share names neither", () => {
  const index = upcIndex([
    { id: "a", upc: null, upcs: ["0816218029890", "0000000000017"] },
    { id: "b", upc: "0634084471724" },
    { id: "c", upc: null, upcs: ["0000000000017"] },
  ]);
  expect(index.get("0816218029890")).toBe("a");
  expect(index.get("0634084471724")).toBe("b");
  expect(index.has("0000000000017")).toBe(false);
});
