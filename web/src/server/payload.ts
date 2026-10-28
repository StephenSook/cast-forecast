import "server-only";
import { RENDER_COVERAGE } from "@/lib/curve";

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * The makeup-vto task body, exactly as the K1b renders sent it (castforecast/k1_render.py `_payload`):
 * skin smoothing off, then one foundation palette at coverage 100 with colorIntensity as the dose.
 */
export function makeupVtoPayload(fileId: string, paletteHex: string, colorIntensity: number): object {
  if (!Number.isInteger(colorIntensity) || colorIntensity < 0 || colorIntensity > 100) {
    throw new RangeError("colorIntensity must be an integer from 0 to 100");
  }
  if (!HEX.test(paletteHex)) throw new RangeError("paletteHex must look like #RRGGBB");
  return {
    src_file_id: fileId,
    version: "1.0",
    effects: [
      { category: "skin_smooth", skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
      {
        category: "foundation",
        palettes: [{ color: paletteHex, colorIntensity, glowIntensity: 0, coverageIntensity: RENDER_COVERAGE }],
      },
    ],
  };
}

/** The skin-tone-analysis task body, as castforecast/k2_tone.py sends it. */
export function tonePayload(fileId: string): object {
  return { src_file_id: fileId, face_angle_strictness_level: "high" };
}
