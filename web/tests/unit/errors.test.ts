import { expect, test } from "vitest";
import { MESSAGES } from "@/lib/messages";
import { errorResponse, mapYouCamError } from "@/server/errors";
import { YouCamError } from "@/server/youcam";

// vendor sources: the "YouCam error code sources" table in the plan; YouCam API docs snapshot 2026-10-27,
// paths relative to recon/youcam_docs_2026-10-27/yaml/
test.each([
  ["error_no_face", 422, "no_face"],                                  // ai_skin_tone_analysis.yaml:540
  ["error_pose", 422, "face_angle"],                                  // ai_skin_tone_analysis.yaml:541
  ["error_face_angle_invalid", 422, "face_angle"],                    // makeup_vto.yaml:1288
  ["error_face_position_invalid", 422, "face_position"],              // makeup_vto.yaml:1279
  ["error_face_position_out_of_boundary", 422, "face_position"],      // makeup_vto.yaml:1285
  ["error_face_position_too_small", 422, "face_too_small"],           // makeup_vto.yaml:1282
  ["error_below_min_image_size", 422, "too_small"],                   // makeup_vto.yaml:1273
  ["error_exceed_max_image_size", 413, "too_large"],                  // makeup_vto.yaml:1276
  ["exceed_max_filesize", 413, "too_large"],                          // makeup_vto.yaml:1460
  ["error_decode_image", 415, "unsupported_image"],                   // makeup_vto.yaml:1463
  ["CreditInsufficiency", 503, "credits_low"],                        // makeup_vto.yaml:2818
  ["InvalidApiKey", 503, "not_configured"],                           // makeup_vto.yaml:2799
  ["InactiveApiKey", 503, "not_configured"],                          // makeup_vto.yaml:2800
  ["ExpiredApiKey", 503, "not_configured"],                           // makeup_vto.yaml:2801
])("vendor code %s maps to %i %s", (code, status, cf) => expect(mapYouCamError(new YouCamError("x", code))).toEqual({ status, code: cf }));
test.each([["http_401", 503, "not_configured"], ["timeout", 504, "timeout"], ["network", 502, "upstream"],
  ["bad_shape", 502, "upstream"], ["bad_json", 502, "upstream"], ["http_500", 502, "upstream"]])(
  "client code %s maps to %i %s", (code, status, cf) => expect(mapYouCamError(new YouCamError("x", code))).toEqual({ status, code: cf }));
test("busy carries retryAfterS 30", () =>
  expect(mapYouCamError(new YouCamError("x", "http_429"))).toEqual({ status: 503, code: "busy", retryAfterS: 30 }));
// UNVERIFIED for the endpoints this app calls: only the fallback is asserted
test.each(["error_multiple_people", "error_large_face_angle", "error_unsupport_ratio", "error_src_face_too_small",
  "error_lighting_dark", "error_face_too_small", "anything_else"])("%s falls back to 502 upstream", (code) =>
  expect(mapYouCamError(new YouCamError("x", code))).toEqual({ status: 502, code: "upstream" }));
test("a non-YouCamError falls back to 502 upstream", () => {
  expect(mapYouCamError(new Error("x"))).toEqual({ status: 502, code: "upstream" });
  expect(mapYouCamError("x")).toEqual({ status: 502, code: "upstream" });
});
test("every message is one line with no em or en dash", () => { for (const m of Object.values(MESSAGES)) { expect(m).not.toMatch(/[\u2013\u2014\n]/); } });
test("errorResponse is JSON with the mapped message and Retry-After", async () => {
  const r = errorResponse("busy", 503, 30);
  expect(r.status).toBe(503);
  expect(r.headers.get("content-type")).toMatch(/^application\/json/);
  expect(r.headers.get("retry-after")).toBe("30");
  expect(await r.json()).toEqual({ error: { code: "busy", message: MESSAGES.busy } });
  expect(errorResponse("upstream", 502).headers.get("retry-after")).toBeNull();
});

// Beyond the brief.
test.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("inherited name %s falls back to upstream", (code) =>
  expect(mapYouCamError(new YouCamError("x", code))).toEqual({ status: 502, code: "upstream" }));
test("an error object that only looks like a YouCamError falls back to upstream", () =>
  expect(mapYouCamError({ code: "CreditInsufficiency", message: "x" })).toEqual({ status: 502, code: "upstream" }));
test("the message table is exactly the plan's copy", () => expect(MESSAGES).toEqual({
  bad_request: "Something was missing. Nothing was sent.",
  session_missing: "Take the selfie again.",
  unknown_bottle: "That bottle is not in the catalogue.",
  too_large: "That photo is too large.",
  too_small: "That photo is too small.",
  unsupported_image: "Use a JPEG or PNG photo.",
  no_face: "No face found. No render was made.",
  face_position: "Fit your whole face in the frame. No render was made.",
  face_angle: "Face the camera straight on. No render was made.",
  face_too_small: "Move closer. No render was made.",
  rate_limited: "Too many tries. Wait a minute.",
  busy: "Busy right now. Try again in 30 seconds.",
  credits_low: "Try-on is paused. Evidence is open.",
  not_configured: "Try-on is paused. Evidence is open.",
  upstream: "That did not go through. Try again.",
  timeout: "That took too long. Try again.",
}));
test("error responses are never cached", () => expect(errorResponse("timeout", 504).headers.get("cache-control")).toBe("no-store"));
