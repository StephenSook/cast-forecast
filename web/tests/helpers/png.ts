import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Samples per pixel for the colour types handled here: greyscale, RGB, grey + alpha, RGBA (no palette). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
/** The bit depths the PNG spec allows for each of those colour types. */
const DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 4: [8, 16], 6: [8, 16] };
/** Row filter types 0 to 4 (None, Sub, Up, Average, Paeth); any other byte cannot be decoded. */
const MAX_FILTER = 4;

/**
 * The size of a PNG that decodes, else null: the signature, every chunk's length and CRC, IHDR first with a positive
 * size, an allowed colour type and bit depth and compression, filter and interlace methods 0, IEND last with nothing
 * after it, the joined IDAT data inflating to exactly one filter byte plus one row of samples per row, and every row's
 * filter byte one of the five defined. With all of that true, undoing the filters cannot fail, so this is a full
 * decode check: a truncated or corrupted download fails here even when its first bytes still look like a PNG.
 * Palette and interlaced images are not handled and read as null.
 */
export function pngIntact(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 8 + 25 + 12 || SIGNATURE.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8;
  let header: { width: number; height: number; depth: number; type: number } | null = null;
  const idat: Uint8Array[] = [];
  for (;;) {
    if (at + 12 > b.length) return null;
    const len = view.getUint32(at);
    if (at + 12 + len > b.length) return null;
    const typeAndData = b.subarray(at + 4, at + 8 + len);
    if (crc32(typeAndData) !== view.getUint32(at + 8 + len)) return null;
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    const data = b.subarray(at + 8, at + 8 + len);
    if (header === null && type !== "IHDR") return null;
    if (type === "IHDR") {
      if (header !== null || len !== 13) return null;
      const t = data[9];
      const ok = t in CHANNELS && DEPTHS[t].includes(data[8]) && data[10] === 0 && data[11] === 0 && data[12] === 0;
      header = ok ? { width: view.getUint32(at + 8), height: view.getUint32(at + 12), depth: data[8], type: t } : null;
      if (!header || header.width === 0 || header.height === 0) return null;
    } else if (type === "IDAT") idat.push(data);
    at += 12 + len;
    if (type === "IEND") break;
  }
  if (!header || at !== b.length || idat.length === 0) return null;
  const rowBytes = Math.ceil((header.width * CHANNELS[header.type] * header.depth) / 8);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (pixels.length !== header.height * (1 + rowBytes)) return null;
  for (let row = 0; row < header.height; row++) if (pixels[row * (1 + rowBytes)] > MAX_FILTER) return null;
  return { width: header.width, height: header.height };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A w x h RGBA PNG with every pixel `rgba` and every row's filter byte `filter`, for tests. Every CRC is correct, so
 * with a filter byte above 4 only the decode is wrong.
 */
export function makePng(w: number, h: number, rgba: readonly [number, number, number, number] = [200, 150, 120, 255], filter = 0): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = filter;
    for (let x = 0; x < w; x++) raw.set(rgba, y * (1 + w * 4) + 1 + x * 4);
  }
  return new Uint8Array(Buffer.concat([Buffer.from(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
}
