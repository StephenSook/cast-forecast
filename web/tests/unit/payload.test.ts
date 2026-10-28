import { expect, test } from "vitest";
import { makeupVtoPayload, tonePayload } from "@/server/payload";

test("makeup-vto payload is exactly the K1b render effects (k1_render.py:321-339, _payload)", () => {
  expect(makeupVtoPayload("f1", "#FFFFFF", 49)).toEqual({ src_file_id: "f1", version: "1.0", effects: [
    { category: "skin_smooth", skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
    { category: "foundation", palettes: [{ color: "#FFFFFF", colorIntensity: 49, glowIntensity: 0, coverageIntensity: 100 }] }] });
});
test("makeup-vto payload refuses a fractional or out-of-range intensity and a non-hex colour", () => {
  expect(() => makeupVtoPayload("f1", "#FFFFFF", 49.5)).toThrow(RangeError);
  expect(() => makeupVtoPayload("f1", "#FFFFFF", 101)).toThrow(RangeError);
  expect(() => makeupVtoPayload("f1", "white", 49)).toThrow(RangeError);
});
test("makeup-vto payload edges", () => {
  for (const ci of [0, 100]) expect(() => makeupVtoPayload("f1", "#a0B1c2", ci)).not.toThrow();
  for (const ci of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => makeupVtoPayload("f1", "#FFFFFF", ci)).toThrow(RangeError);
  for (const hex of ["#FFF", "#FFFFFFF", "FFFFFF", "#GGGGGG", "#FFFFFF\n"]) expect(() => makeupVtoPayload("f1", hex, 49), hex).toThrow(RangeError);
});
test("tone payload asks for high face-angle strictness", () =>
  expect(tonePayload("f1")).toEqual({ src_file_id: "f1", face_angle_strictness_level: "high" }));
