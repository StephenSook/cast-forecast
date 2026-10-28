import { expect, test, vi } from "vitest";
import { MESSAGES } from "@/lib/messages";
import { ImageError, type ImageDeps, JPEG_QUALITY, MIN_SHORT_SIDE, RENDER_MAX, fitWithin, prepareImage } from "@/lib/image";

// Expected sizes computed with castforecast.preflight.upload_copy rounding.
test.each([[4032, 3024, 1438, 1079], [3024, 4032, 809, 1079], [1920, 1080, 1918, 1079], [1919, 1079, 1919, 1079], [1080, 1920, 606, 1079],
  [640, 480, 640, 480], [4000, 4000, 1079, 1079], [5712, 4284, 1438, 1079], [4284, 5712, 809, 1079], [1170, 2532, 498, 1079]])(
  "fitWithin(%i, %i) matches upload_copy", (w, h, ew, eh) => expect(fitWithin(w, h)).toEqual({ width: ew, height: eh }));

test("render limits and JPEG quality", () => {
  expect(RENDER_MAX).toEqual({ width: 1920, height: 1080 });
  expect(MIN_SHORT_SIDE).toBe(480);
  expect(JPEG_QUALITY).toBe(0.92);
});

const src = {} as CanvasImageSource;
function deps(w: number, h: number, o: Partial<ImageDeps> = {}) {
  const close = vi.fn();
  const d = { decode: vi.fn(async () => ({ width: w, height: h, source: src, close })),
    encode: vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" })), objectUrl: vi.fn(() => "blob:test"), ...o };
  return { d, close };
}
test("prepareImage encodes a JPEG at the fitted size through the canvas", async () => {
  const { d } = deps(4032, 3024);
  const p = await prepareImage(new Blob(["x"]), d);
  expect(d.encode).toHaveBeenCalledWith(src, 1438, 1079);
  expect(p).toMatchObject({ width: 1438, height: 1079, url: "blob:test" }); expect(p.blob.type).toBe("image/jpeg");
});
test("prepareImage rejects too_small when the fitted short side is under 480", async () => {
  const { d, close } = deps(1080, 4000);                                                    // fits to 291x1079
  await expect(prepareImage(new Blob(["x"]), d)).rejects.toMatchObject({ code: "too_small" });
  expect(d.encode).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});
test("prepareImage maps a decode failure to unsupported_image", async () => {              // Review Focus 2
  const { d } = deps(0, 0, { decode: vi.fn(async () => { throw new Error("decode"); }) });
  const e = await prepareImage(new Blob(["x"]), d).catch((x) => x);
  expect(e).toBeInstanceOf(ImageError); expect(e.code).toBe("unsupported_image");
});
test("prepareImage closes the bitmap after encoding", async () => {
  const { d, close } = deps(640, 480);
  await prepareImage(new Blob(["x"]), d);
  expect(close).toHaveBeenCalledTimes(1);
});

test("an encode failure is unsupported_image, closes the bitmap and makes no object URL", async () => {
  const { d, close } = deps(640, 480, { encode: vi.fn(async () => { throw new Error("toBlob gave null"); }) });
  await expect(prepareImage(new Blob(["x"]), d)).rejects.toMatchObject({ code: "unsupported_image" });
  expect(close).toHaveBeenCalledTimes(1); expect(d.objectUrl).not.toHaveBeenCalled();
});

test("a decoded image with no size is too_small", async () => {
  const { d, close } = deps(0, 0);
  await expect(prepareImage(new Blob(["x"]), d)).rejects.toMatchObject({ code: "too_small" });
  expect(close).toHaveBeenCalledTimes(1);
});

test("ImageError carries the visitor's line for its code", () => {
  for (const code of ["unsupported_image", "too_small"] as const) {
    const e = new ImageError(code);
    expect(e).toBeInstanceOf(Error); expect(e.code).toBe(code); expect(e.message).toBe(MESSAGES[code]);
  }
});
