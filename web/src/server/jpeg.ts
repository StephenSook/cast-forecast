import "server-only";

/** Largest upload body accepted, in bytes. */
export const MAX_UPLOAD_BYTES = 4_000_000;
// makeup_vto.yaml:1276: the source must be under 1920 wide and under 1080 high (strict).
const MAX_WIDTH_EXCLUSIVE = 1920;
const MAX_HEIGHT_EXCLUSIVE = 1080;
const MIN_SHORT_SIDE = 480;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP1 = 0xe1; // Exif, XMP
const APP13 = 0xed; // IPTC

// Frame headers SOF0-3, SOF5-7, SOF9-11, SOF13-15. Not C4 (DHT), C8 (reserved) or CC (DAC).
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
// Markers with no length field: RST0-7 and TEM.
const isStandalone = (m: number) => (m >= 0xd0 && m <= 0xd7) || m === 0x01;

/** `start` is the segment's first fill byte, `lenAt` its two length bytes (-1 when it has none), `end` one past it. */
type Segment = { start: number; marker: number; lenAt: number; end: number };

/**
 * The marker segments after SOI, ending with the SOS or EOI marker (whose `end` is its `start`).
 * Null for anything malformed: no SOI, a stray byte, a length past the end, or no SOS or EOI at all.
 */
function segments(b: Uint8Array): Segment[] | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  const out: Segment[] = [];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const start = i;
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return null;
    const marker = b[i++];
    if (marker === SOS || marker === EOI) {
      out.push({ start, marker, lenAt: -1, end: start });
      return out;
    }
    if (marker === SOI) return null;
    if (isStandalone(marker)) {
      out.push({ start, marker, lenAt: -1, end: i });
      continue;
    }
    if (i + 2 > b.length) return null;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return null;
    out.push({ start, marker, lenAt: i, end: i + len });
    i += len;
  }
  return null;
}

/** Stored pixel size from the first frame header before the scan, or null. EXIF orientation is not applied. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  const segs = segments(b);
  const sof = segs?.find((s) => isSof(s.marker));
  if (!sof || sof.end - sof.lenAt < 7) return null;
  // Big-endian, counted from the length field: precision at +2, height at +3, width at +5.
  const height = (b[sof.lenAt + 3] << 8) | b[sof.lenAt + 4];
  const width = (b[sof.lenAt + 5] << 8) | b[sof.lenAt + 6];
  return width > 0 && height > 0 ? { width, height } : null;
}

export function checkUploadImage(
  b: Uint8Array,
):
  | { ok: true; width: number; height: number }
  | { ok: false; code: "unsupported_image" | "too_large" | "too_small"; status: 415 | 413 | 422 } {
  if (b.length > MAX_UPLOAD_BYTES) return { ok: false, code: "too_large", status: 413 };
  const size = jpegSize(b);
  if (!size) return { ok: false, code: "unsupported_image", status: 415 };
  const { width, height } = size;
  if (width >= MAX_WIDTH_EXCLUSIVE || height >= MAX_HEIGHT_EXCLUSIVE) return { ok: false, code: "too_large", status: 413 };
  if (Math.min(width, height) < MIN_SHORT_SIDE) return { ok: false, code: "too_small", status: 422 };
  return { ok: true, width, height };
}

/**
 * A copy without every APP1 (Exif, XMP) and APP13 (IPTC) segment before the scan, fill bytes included.
 * Every other byte is kept in order, and everything from SOS (or EOI) on is copied verbatim.
 * Null when the stream is malformed, including a segment length that runs past the end.
 */
export function stripMetadata(b: Uint8Array): Uint8Array | null {
  const segs = segments(b);
  if (!segs) return null;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  for (const s of segs) {
    if (s.marker === SOS || s.marker === EOI) keep.push(b.subarray(s.start));
    else if (s.marker !== APP1 && s.marker !== APP13) keep.push(b.subarray(s.start, s.end));
  }
  const out = new Uint8Array(keep.reduce((n, k) => n + k.length, 0));
  let at = 0;
  for (const k of keep) {
    out.set(k, at);
    at += k.length;
  }
  return out;
}
