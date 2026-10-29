import type { CfErrorCode } from "@/lib/messages";
import type { Fitzpatrick } from "@/lib/skinType";

/** A finished try-on. `imageUrl` is YouCam's result URL, which lives about 2 hours (`expiresAt`, epoch ms). */
export type RenderResult = {
  imageUrl: string;
  bottleId: string;
  colorIntensity: number;
  predictedBlend: number;
  expiresAt: number;
};

export type ToneResult = { skinColor: string };

/** YouCam's Fitzpatrick skin type for an uploaded selfie. */
export type SkinTypeResult = { fitzpatrick: Fitzpatrick };

export type ApiErrorBody = { error: { code: CfErrorCode; message: string } };
