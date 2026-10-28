import { expect, test } from "vitest";
import { scanForNeedles } from "../bundle/scan";

// Owner-only (pnpm test:keyscan, after pnpm build). Fails when the key is unset, never skips,
// and never prints the key: a hit is reported with a redacted needle.
test("client bundle carries no key value", () => {
  const k = process.env.YOUCAM_API_KEY ?? "";
  expect(k.length, "YOUCAM_API_KEY is unset; this check fails, never skips").toBeGreaterThanOrEqual(16);
  const r = scanForNeedles(".next/static", [k], [".js"]);
  expect(r.files).toBeGreaterThanOrEqual(5);
  expect(r.hits.map((h) => ({ file: h.file, needle: "[redacted YOUCAM_API_KEY value]" }))).toEqual([]);
});
