import { MESSAGES } from "@/lib/messages";

/** makeup_vto.yaml:1276: the render source must be under 1920 wide and under 1080 high (strict). */
export const RENDER_MAX = { width: 1920, height: 1080 } as const;
/** Smallest short side after the shrink: castforecast/preflight.py MIN_SHORT_SIDE, the floor /api/upload also holds. */
export const MIN_SHORT_SIDE = 480;
export const JPEG_QUALITY = 0.92;

/**
 * The size a photo is shrunk to so it fits strictly under `maxW` x `maxH`, keeping its aspect. Never enlarges.
 * Same arithmetic and truncation as castforecast/preflight.py:107-114 (upload_copy), so the web and the gates agree.
 */
export function fitWithin(w: number, h: number, maxW = RENDER_MAX.width, maxH = RENDER_MAX.height): { width: number; height: number } {
  const mw = maxW - 1;
  const mh = maxH - 1;
  const s = Math.min(mw / w, mh / h, 1);
  return s < 1
    ? { width: Math.min(mw, Math.max(1, Math.trunc(w * s))), height: Math.min(mh, Math.max(1, Math.trunc(h * s))) }
    : { width: w, height: h };
}

/** A selfie ready to send: a fresh JPEG (pixels only, so no metadata), its size, and an object URL for the preview. */
export type PreparedImage = { blob: Blob; width: number; height: number; url: string };

export type ImageDeps = {
  decode(f: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close(): void }>;
  encode(src: CanvasImageSource, w: number, h: number): Promise<Blob>;
  objectUrl(b: Blob): string;
};

export class ImageError extends Error {
  readonly code: "unsupported_image" | "too_small";
  constructor(code: "unsupported_image" | "too_small") {
    super(MESSAGES[code]);
    this.name = "ImageError";
    this.code = code;
  }
}

/**
 * Browser decode and encode. The decode applies the EXIF orientation, so a phone photo stored sideways comes out
 * upright; the encode draws only pixels onto a canvas, so nothing from the source file (EXIF, GPS, XMP) survives.
 */
export const browserImageDeps: ImageDeps = {
  async decode(f) {
    const bitmap = await createImageBitmap(f, { imageOrientation: "from-image" });
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  encode(src, w, h) {
    return new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      // A canvas holds its pixels until it is resized; iOS caps the total canvas memory a page may hold.
      const release = () => {
        canvas.width = 0;
        canvas.height = 0;
      };
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        release();
        reject(new Error("no 2d context"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          release();
          if (blob && blob.type === "image/jpeg") resolve(blob);
          else reject(new Error("the canvas made no JPEG"));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  },
  objectUrl: (b) => URL.createObjectURL(b),
};

/**
 * Decodes `file`, shrinks it to fit the render limits and re-encodes it as a JPEG. Rejects with ImageError:
 * unsupported_image when the browser cannot decode or encode it, too_small when the short side ends under 480.
 * The decoded bitmap is closed on every path after the decode.
 */
export async function prepareImage(file: Blob, deps: ImageDeps = browserImageDeps): Promise<PreparedImage> {
  let decoded: Awaited<ReturnType<ImageDeps["decode"]>>;
  try {
    decoded = await deps.decode(file);
  } catch {
    throw new ImageError("unsupported_image");
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height);
    if (!(Math.min(width, height) >= MIN_SHORT_SIDE)) throw new ImageError("too_small");
    let blob: Blob;
    try {
      blob = await deps.encode(decoded.source, width, height);
    } catch {
      throw new ImageError("unsupported_image");
    }
    return { blob, width, height, url: deps.objectUrl(blob) };
  } finally {
    decoded.close();
  }
}

/** Frees a prepared image's preview URL. Every PreparedImage that is dropped goes through here. */
export function releaseImage(image: Pick<PreparedImage, "url">): void {
  URL.revokeObjectURL(image.url);
}
