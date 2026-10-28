import { expect, test } from "vitest";
import { FORBIDDEN, scanForNeedles } from "./scan";

test("client bundle exists and is not trivial", () => {
  expect(scanForNeedles(".next/static", FORBIDDEN, [".js"]).files).toBeGreaterThanOrEqual(5); // fails, never skips
});
test("client bundle carries no key name, no Bearer, no YouCam host", () => {
  expect(scanForNeedles(".next/static", FORBIDDEN, [".js"]).hits).toEqual([]);
});
