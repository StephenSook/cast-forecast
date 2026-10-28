import { type Bottle, CATALOGUE, findBottle } from "@/lib/catalogue";
import type { PreparedImage } from "@/lib/image";
import type { CfErrorCode } from "@/lib/messages";
import type { RenderResult } from "@/lib/types";

/**
 * The Try screen's state. `message` is the server's own line for a failure when it must be shown verbatim (a 429
 * states the real wait, up to an hour); otherwise the line is MESSAGES[code].
 */
export type TryState = {
  phase: "empty" | "ready" | "uploading" | "rendering" | "result" | "error";
  image: PreparedImage | null;
  fileId: string | null;
  bottleId: string | null;
  result: RenderResult | null;
  code: CfErrorCode | null;
  message: string | null;
  expired: boolean;
};

export type TryEvent =
  | { type: "PHOTO_READY"; image: PreparedImage }
  | { type: "PICK"; bottleId: string }
  | { type: "UPLOADED"; fileId: string }
  | { type: "RENDERED"; result: RenderResult }
  | { type: "FAILED"; code: CfErrorCode; message?: string }
  | { type: "IMAGE_EXPIRED" };

export const EXPIRED_LINE = "That render expired. Pick the bottle again.";

export function initialTryState(bottleId: string | null = null): TryState {
  return { phase: "empty", image: null, fileId: null, bottleId, result: null, code: null, message: null, expired: false };
}

/** A bottle can be picked once there is a photo and nothing is in flight. */
export function canPick(s: TryState): boolean {
  return s.image !== null && (s.phase === "ready" || s.phase === "result" || s.phase === "error");
}

/**
 * Pure transitions. An event that does not apply in the current phase returns `s` itself, so a second tap while a
 * render is in flight, or an answer for a step that was abandoned, changes nothing.
 */
export function tryReducer(s: TryState, e: TryEvent): TryState {
  switch (e.type) {
    case "PHOTO_READY":
      return { ...s, phase: "ready", image: e.image, fileId: null, result: null, code: null, message: null, expired: false };
    case "PICK":
      if (!canPick(s)) return s;
      return { ...s, phase: s.fileId === null ? "uploading" : "rendering", bottleId: e.bottleId, code: null, message: null, expired: false };
    case "UPLOADED":
      return s.phase === "uploading" ? { ...s, phase: "rendering", fileId: e.fileId } : s;
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
