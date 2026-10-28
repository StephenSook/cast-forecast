import "server-only";
import { type CfErrorCode, MESSAGES } from "@/lib/messages";
import { YouCamError } from "@/server/youcam";

export type MappedError = { status: number; code: CfErrorCode; retryAfterS?: number };

const BUSY_RETRY_S = 30;

/**
 * Vendor codes documented for the two task endpoints this app calls. Each entry cites the YouCam API docs
 * snapshot of 2026-10-27 (recon/youcam_docs_2026-10-27/yaml/, local only). Any other code is upstream.
 */
const VENDOR = new Map<string, Omit<MappedError, "retryAfterS">>([
  ["error_no_face", { status: 422, code: "no_face" }], // ai_skin_tone_analysis.yaml:540, :568
  ["error_pose", { status: 422, code: "face_angle" }], // ai_skin_tone_analysis.yaml:541, :570
  ["error_face_angle_invalid", { status: 422, code: "face_angle" }], // makeup_vto.yaml:1288
  ["error_face_position_invalid", { status: 422, code: "face_position" }], // makeup_vto.yaml:1279, ai_skin_tone_analysis.yaml:176
  ["error_face_position_out_of_boundary", { status: 422, code: "face_position" }], // makeup_vto.yaml:1285, ai_skin_tone_analysis.yaml:181
  ["error_face_position_too_small", { status: 422, code: "face_too_small" }], // makeup_vto.yaml:1282, ai_skin_tone_analysis.yaml:179
  ["error_below_min_image_size", { status: 422, code: "too_small" }], // makeup_vto.yaml:1273, ai_skin_tone_analysis.yaml:173
  ["error_exceed_max_image_size", { status: 413, code: "too_large" }], // makeup_vto.yaml:1276, ai_skin_tone_analysis.yaml:532
  ["exceed_max_filesize", { status: 413, code: "too_large" }], // makeup_vto.yaml:1460
  ["error_decode_image", { status: 415, code: "unsupported_image" }], // makeup_vto.yaml:1463
  ["CreditInsufficiency", { status: 503, code: "credits_low" }], // makeup_vto.yaml:2818
  ["InvalidApiKey", { status: 503, code: "not_configured" }], // makeup_vto.yaml:2799
  ["InactiveApiKey", { status: 503, code: "not_configured" }], // makeup_vto.yaml:2800
  ["ExpiredApiKey", { status: 503, code: "not_configured" }], // makeup_vto.yaml:2801
  // Client-made codes (youcam.ts), not vendor codes.
  ["http_401", { status: 503, code: "not_configured" }],
  ["timeout", { status: 504, code: "timeout" }],
]);

/** Maps a YouCam client failure to the status and code the API answers with. Unknown failures are 502 upstream. */
export function mapYouCamError(e: unknown): MappedError {
  if (!(e instanceof YouCamError)) return { status: 502, code: "upstream" };
  if (e.code === "http_429") return { status: 503, code: "busy", retryAfterS: BUSY_RETRY_S };
  const hit = VENDOR.get(e.code);
  return hit ? { status: hit.status, code: hit.code } : { status: 502, code: "upstream" };
}

/** A JSON error body with the visitor's line for `code`, never cached, with Retry-After when given. */
export function errorResponse(code: CfErrorCode, status: number, retryAfterS?: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterS !== undefined) headers["Retry-After"] = String(retryAfterS);
  return Response.json({ error: { code, message: MESSAGES[code] } }, { status, headers });
}
