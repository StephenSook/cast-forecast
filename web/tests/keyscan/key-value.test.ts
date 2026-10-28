import { expect, test } from "vitest";
import { scanForNeedles } from "../bundle/scan";

// Owner-only (pnpm test:keyscan, after pnpm build). Fails when the key is unset, never skips,
// and never prints the key: a hit is reported with a redacted needle.
test("client bundle and prerendered pages carry no key value", () => {
  const k = process.env.YOUCAM_API_KEY ?? "";
  expect(k.length, "YOUCAM_API_KEY is unset; this check fails, never skips").toBeGreaterThanOrEqual(16);
  const chunks = scanForNeedles(".next/static", [k], [".js"]);
  const pages = scanForNeedles(".next/server/app", [k], [".html", ".rsc"]);
  expect(chunks.files).toBeGreaterThanOrEqual(5);
  expect(pages.files).toBeGreaterThanOrEqual(3);
  const redact = (h: { file: string }) => ({ file: h.file, needle: "[redacted YOUCAM_API_KEY value]" });
  expect([...chunks.hits, ...pages.hits].map(redact)).toEqual([]);
});
