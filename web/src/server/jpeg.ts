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
const APP2 = 0xe2; // ICC profile (kept) or an MPF index (dropped with the frames it points to)
// Never needed to decode: Exif and XMP (APP1), C2PA and JUMBF (APP11), IPTC (APP13), comments (COM).
const DROPPED = new Set([0xe1, 0xeb, 0xed, 0xfe]);

// Frame headers SOF0-3, SOF5-7, SOF9-11, SOF13-15. Not C4 (DHT), C8 (reserved) or CC (DAC).
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
// Markers with no length field: RST0-7 and TEM.
const isStandalone = (m: number) => (m >= 0xd0 && m <= 0xd7) || m === 0x01;
const isRst = (m: number) => m >= 0xd0 && m <= 0xd7;

/** `start` is the first fill byte, `lenAt` the two length bytes (-1 when there are none), `end` one past the segment. */
type Segment = { start: number; marker: number; lenAt: number; end: number };

/** Reads the marker segment at `i`. Null when `i` does not hold a marker or the segment runs past the end. */
function segmentAt(b: Uint8Array, i: number): Segment | null {
  if (i >= b.length || b[i] !== 0xff) return null;
  const start = i;
  while (i < b.length && b[i] === 0xff) i++; // fill bytes
  if (i >= b.length) return null;
  const marker = b[i++];
  if (marker === SOI || marker === EOI || isStandalone(marker)) return { start, marker, lenAt: -1, end: i };
  if (i + 2 > b.length) return null;
  const len = (b[i] << 8) | b[i + 1];
  if (len < 2 || i + len > b.length) return null;
  return { start, marker, lenAt: i, end: i + len };
}

/**
 * Index of the marker that ends the entropy-coded data starting at `i`, at the first of its fill bytes. A run of FF
 * is fill before what follows it (as libjpeg reads it): followed by 00 it is one stuffed data byte, followed by
 * RST0-RST7 a restart marker, and both stay in the scan. Null when the data runs off the end. `i` always advances.
 */
function scanEnd(b: Uint8Array, i: number): number | null {
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < b.length && b[j] === 0xff) j++; // fill bytes
    if (j >= b.length) return null;
    const next = b[j];
    if (next === 0x00 || isRst(next)) i = j + 1;
    else return i;
  }
  return null;
}

/** Stored pixel size from the first frame header, read without walking past it. EXIF orientation is not applied. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  let i = 2;
  for (;;) {
    const s = segmentAt(b, i);
    if (!s || s.marker === SOS || s.marker === EOI || s.marker === SOI) return null;
    if (isSof(s.marker)) {
      if (s.end - s.lenAt < 7) return null;
      // Big-endian, counted from the length field: precision at +2, height at +3, width at +5.
      const height = (b[s.lenAt + 3] << 8) | b[s.lenAt + 4];
      const width = (b[s.lenAt + 5] << 8) | b[s.lenAt + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i = s.end;
  }
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

function isMpfIndex(b: Uint8Array, s: Segment): boolean {
  const p = s.lenAt + 2;
  return s.end - p >= 4 && b[p] === 0x4d && b[p + 1] === 0x50 && b[p + 2] === 0x46 && b[p + 3] === 0x00; // "MPF\0"
}

/**
 * A copy of the primary image only, walked marker by marker through every scan (pixels are never decoded).
 * Drops APP1 (Exif, XMP), APP11 (C2PA), APP13 (IPTC) and COM wherever they occur, with their fill bytes,
 * and an APP2 MPF index. Keeps everything else in order: SOF, DHT, DQT, DRI, SOS and its scan data,
 * APP0, an APP2 ICC profile. Stops at the primary image's EOI and drops every byte after it (MPF frames,
 * Motion Photo video). Null on malformed or truncated input, or a scan before any frame header.
 */
export function stripMetadata(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let sawFrame = false;
  let i = 2;
  for (;;) {
    const s = segmentAt(b, i);
    if (!s || s.marker === SOI) return null;
    if (s.marker === EOI) {
      keep.push(b.subarray(s.start, s.end));
      break;
    }
    if (isSof(s.marker)) sawFrame = true;
    if (s.marker === SOS && !sawFrame) return null;
    const drop = DROPPED.has(s.marker) || (s.marker === APP2 && isMpfIndex(b, s));
    if (!drop) keep.push(b.subarray(s.start, s.end));
    i = s.end;
    if (s.marker === SOS) {
      const end = scanEnd(b, i);
      if (end === null) return null;
      keep.push(b.subarray(i, end));
      i = end;
    }
  }
  const out = new Uint8Array(keep.reduce((n, k) => n + k.length, 0));
  let at = 0;
  for (const k of keep) {
    out.set(k, at);
    at += k.length;
  }
  return out;
}
