import { type Bottle, CATALOGUE, findBottle } from "@/lib/catalogue";
import type { PreparedImage } from "@/lib/image";
import type { CfErrorCode } from "@/lib/messages";
import { type Fitzpatrick, SUGGESTED_TONE } from "@/lib/skinType";
import type { RenderResult } from "@/lib/types";

/** Why a step failed: an API error code, or `sample_live`, a label with no recording picked on the sample face. */
export type TryCode = CfErrorCode | "sample_live";

/**
 * The Try screen's state. `message` is the server's own line for a failure when it must be shown verbatim (a 429
 * states the real wait, up to an hour); otherwise the line is MESSAGES[code]. On the sample face (`image.sample`)
 * nothing is uploaded: a pick goes straight to rendering, and its result is a recording.
 */
export type TryState = {
  /** `reading`: the selfie is being uploaded and read for a skin type, which then suggests a tone. */
  phase: "empty" | "ready" | "uploading" | "rendering" | "reading" | "result" | "error";
  image: PreparedImage | null;
  fileId: string | null;
  bottleId: string | null;
  /** The L* of the skin tone picked, "deeper" for skin past the study's range (no prediction), or null before a pick. */
  tone: number | "deeper" | null;
  /** YouCam's Fitzpatrick type for this photo, once read. */
  skinType: Fitzpatrick | null;
  result: RenderResult | null;
  code: TryCode | null;
  message: string | null;
  expired: boolean;
};

export type TryEvent =
  | { type: "PHOTO_READY"; image: PreparedImage }
  | { type: "TONE"; tone: number | "deeper" }
  | { type: "PICK"; bottleId: string }
  /** A bottle chosen before a render can start (no photo or tone yet): it is marked picked, nothing is sent. */
  | { type: "SELECT"; bottleId: string }
  | { type: "READ_SKIN" }
  | { type: "SKIN_READ"; fitzpatrick: Fitzpatrick }
  | { type: "UPLOADED"; fileId: string }
  | { type: "RENDERED"; result: RenderResult }
  | { type: "FAILED"; code: TryCode; message?: string }
  | { type: "IMAGE_EXPIRED" };

export const EXPIRED_LINE = "That render expired. Pick the bottle again.";

export function initialTryState(bottleId: string | null = null, tone: number | null = null): TryState {
  return {
    phase: "empty",
    image: null,
    fileId: null,
    bottleId,
    tone,
    skinType: null,
    result: null,
    code: null,
    message: null,
    expired: false,
  };
}

/** Nothing is in flight. */
function settled(s: TryState): boolean {
  return s.phase === "empty" || s.phase === "ready" || s.phase === "result" || s.phase === "error";
}

/** A bottle can be picked once there is a photo and a tone with a prediction, and nothing is in flight. */
export function canPick(s: TryState): boolean {
  return s.image !== null && typeof s.tone === "number" && s.phase !== "empty" && settled(s);
}

/** The selfie can be read for a skin type once there is a photo and nothing is in flight. */
export function canSuggest(s: TryState): boolean {
  return s.image !== null && s.phase !== "empty" && settled(s);
}

/**
 * Pure transitions. An event that does not apply in the current phase returns `s` itself, so a second tap while a
 * render is in flight, or an answer for a step that was abandoned, changes nothing.
 */
export function tryReducer(s: TryState, e: TryEvent): TryState {
  switch (e.type) {
    case "PHOTO_READY":
      return { ...s, phase: "ready", image: e.image, fileId: null, skinType: null, result: null, code: null, message: null, expired: false };
    case "TONE":
      // A shown render belongs to the old tone, so it goes; the uploaded file and any line about the photo stay.
      if (!settled(s)) return s;
      return s.phase === "result" ? { ...s, tone: e.tone, phase: "ready", result: null } : { ...s, tone: e.tone };
    case "PICK":
      if (!canPick(s)) return s;
      // The sample face is never uploaded, so its pick has no upload step.
      return {
        ...s,
        phase: s.fileId === null && !s.image?.sample ? "uploading" : "rendering",
        bottleId: e.bottleId,
        code: null,
        message: null,
        expired: false,
      };
    case "SELECT":
      return settled(s) && !canPick(s) ? { ...s, bottleId: e.bottleId } : s;
    case "READ_SKIN":
      // A shown render may belong to a tone the suggestion replaces, so it goes, as for TONE.
      if (!canSuggest(s)) return s;
      return { ...s, phase: "reading", result: null, code: null, message: null, expired: false };
    case "SKIN_READ":
      return s.phase === "reading" ? { ...s, phase: "ready", skinType: e.fitzpatrick, tone: SUGGESTED_TONE[e.fitzpatrick] } : s;
    case "UPLOADED":
      if (s.phase === "uploading") return { ...s, phase: "rendering", fileId: e.fileId };
      return s.phase === "reading" ? { ...s, fileId: e.fileId } : s;
    case "RENDERED":
      return s.phase === "rendering" ? { ...s, phase: "result", result: e.result } : s;
    case "FAILED":
      return {
        ...s,
        phase: "error",
        code: e.code,
        message: e.message ?? null,
        expired: false,
        // The server no longer knows this file: the next pick uploads the photo again.
        fileId: e.code === "session_missing" ? null : s.fileId,
      };
    case "IMAGE_EXPIRED":
      return s.phase === "result" ? { ...s, phase: "ready", result: null, fileId: null, expired: true } : s;
  }
}

/** The `?bottle=` value when it names a bottle in `list`, else null. A repeated parameter names nothing. */
export function bottleFromParam(v: string | string[] | undefined, list: readonly Bottle[] = CATALOGUE): string | null {
  return typeof v === "string" && findBottle(v, list) ? v : null;
}
