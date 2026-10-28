import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FORBIDDEN, scanForNeedles } from "../bundle/scan";

test("scanForNeedles finds a planted needle and counts files", () => {
  const d = mkdtempSync(join(tmpdir(), "cf-scan-"));
  writeFileSync(join(d, "a.js"), "x Bearer y");
  writeFileSync(join(d, "b.css"), "Bearer");
  expect(scanForNeedles(d, FORBIDDEN, [".js"])).toEqual({ files: 1, hits: [{ file: join(d, "a.js"), needle: "Bearer" }] });
});

test("scanForNeedles throws when the directory is missing", () => {
  expect(() => scanForNeedles("/nope", FORBIDDEN)).toThrow();
});

test("FORBIDDEN lists the key names, the auth scheme and the YouCam host", () => {
  expect([...FORBIDDEN]).toEqual(["YOUCAM_API_KEY", "SESSION_SECRET", "CREDIT_FLOOR", "Bearer", "yce-api-01.makeupar.com", "s2s/v2.0"]);
});
