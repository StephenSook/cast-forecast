/** Minimal JPEG marker bytes for size and metadata tests. There is no image data, so nothing can decode it. */

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
// APP0 JFIF 1.1, no density, no thumbnail.
const APP0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

// "Exif" + two zero bytes, then 8 bytes (a little-endian TIFF header pointing at offset 8).
const APP1 = segment(0xe1, [...ascii("Exif"), 0, 0, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
// "Photoshop 3.0" + one zero byte, then 8 bytes (an IPTC resource block header).
const APP13 = segment(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("8BIM"), 0x04, 0x04, 0x00, 0x00]);

/**
 * SOI, one APP0, optional APP1 (Exif) and APP13 (IPTC), the SOF carrying the size, EOI.
 * Without `meta` the bytes equal the output with `meta` minus those two segments.
 */
export function fakeJpeg(
  width: number,
  height: number,
  sof: "SOF0" | "SOF2" = "SOF0",
  meta?: { app1?: boolean; app13?: boolean },
): Uint8Array {
  const marker = sof === "SOF2" ? 0xc2 : 0xc0;
  // precision 8, height, width, 3 components (id, sampling, quant table)
  const sofSeg = segment(marker, [
    8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
  return new Uint8Array([
    ...SOI,
    ...APP0,
    ...(meta?.app1 ? APP1 : []),
    ...(meta?.app13 ? APP13 : []),
    ...sofSeg,
    ...EOI,
  ]);
}
