/** Error codes the API returns, and the one line the visitor sees for each. No server import, so client code can use it. */
export type CfErrorCode =
  | "bad_request"
  | "session_missing"
  | "unknown_bottle"
  | "too_large"
  | "too_small"
  | "unsupported_image"
  | "no_face"
  | "face_position"
  | "face_angle"
  | "face_too_small"
  | "rate_limited"
  | "busy"
  | "credits_low"
  | "not_configured"
  | "upstream"
  | "timeout";

export const MESSAGES: Record<CfErrorCode, string> = {
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
};
