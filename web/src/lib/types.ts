import type { CfErrorCode } from "@/lib/messages";
import type { Fitzpatrick } from "@/lib/skinType";

/**
 * A finished try-on. `imageUrl` is YouCam's result URL, which lives about 2 hours (`expiresAt`, epoch ms). A sample
 * face's render is a recording instead: `imageUrl` is the site's own copy and `recordedOn` its YYYY-MM-DD date. The
 * API client never sets `recordedOn`, so no live answer can be shown as a recording or the other way round.
 */
export type RenderResult = {
  imageUrl: string;
  bottleId: string;
  colorIntensity: number;
  predictedBlend: number;
  expiresAt: number;
  recordedOn?: string;
};

export type ToneResult = { skinColor: string };

/** YouCam's Fitzpatrick skin type for an uploaded selfie. */
export type SkinTypeResult = { fitzpatrick: Fitzpatrick };

export type ApiErrorBody = { error: { code: CfErrorCode; message: string } };
