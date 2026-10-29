import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Samples per pixel for each PNG colour type (greyscale, RGB, palette, grey + alpha, RGBA). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * The size of a PNG whose every byte checks out, else null: the signature, every chunk's length and CRC, IHDR first,
 * IEND last with nothing after it, and the joined IDAT data inflating to exactly one filter byte plus one row of samples
 * per row. That is a full decode short of undoing the row filters, so a truncated or corrupted download fails here
 * even when its first bytes still look like a PNG. Interlaced images are not handled and read as null.
 */
export function pngIntact(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 8 + 25 + 12 || SIGNATURE.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8;
  let header: { width: number; height: number; depth: number; type: number; interlace: number } | null = null;
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
      header = { width: view.getUint32(at + 8), height: view.getUint32(at + 12), depth: data[8], type: data[9], interlace: data[12] };
    } else if (type === "IDAT") idat.push(data);
    at += 12 + len;
    if (type === "IEND") break;
  }
  if (!header || at !== b.length || header.interlace !== 0 || !(header.type in CHANNELS)) return null;
  const rowBytes = Math.ceil((header.width * CHANNELS[header.type] * header.depth) / 8);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  return pixels.length === header.height * (1 + rowBytes) ? { width: header.width, height: header.height } : null;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A valid w x h RGBA PNG (every row filter 0, every pixel `rgba`), for tests. */
export function makePng(w: number, h: number, rgba: readonly [number, number, number, number] = [200, 150, 120, 255]): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * (1 + w * 4) + 1 + x * 4);
  return new Uint8Array(Buffer.concat([Buffer.from(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
}
