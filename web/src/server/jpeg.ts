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
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;
const APP0 = 0xe0; // kept only as JFIF, rewritten without its thumbnail
const APP2 = 0xe2; // kept only as an ICC profile (never MPF or FlashPix)
const APP14 = 0xee; // kept only as Adobe (it says how to read the colour components)
const COM = 0xfe;
const isApp = (m: number) => m >= 0xe0 && m <= 0xef;

const ascii = (s: string): readonly number[] => Object.freeze([...s].map((c) => c.charCodeAt(0)));
const JFIF_ID = ascii("JFIF\0");
const ICC_ID = ascii("ICC_PROFILE\0");
const ADOBE_ID = ascii("Adobe");
// JFIF APP0 payload before the thumbnail: identifier 5, version 2, units 1, X and Y density 2 each.
const JFIF_HEAD = 12;

// Frame headers SOF0-3, SOF5-7, SOF9-11, SOF13-15. Not C4 (DHT), C8 (reserved) or CC (DAC).
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
// Markers with no length field: RST0-7 and TEM.
const isStandalone = (m: number) => (m >= 0xd0 && m <= 0xd7) || m === 0x01;
const isRst = (m: number) => m >= 0xd0 && m <= 0xd7;

/**
 * Most marker segments a file may hold outside its entropy-coded scans (SOI not counted). Real encoders write a few
 * dozen; a crafted body of millions of tiny segments is refused at this count instead of being walked.
 */
export const MAX_SEGMENTS = 512;

/**
 * The segment just read: `start` is the first fill byte, `lenAt` the two length bytes (-1 when there are none), `end`
 * one past the segment. One per walk, overwritten at each step, so a walk allocates nothing per marker.
 */
type Segment = { start: number; marker: number; lenAt: number; end: number };
const cursor = (): Segment => ({ start: 0, marker: 0, lenAt: -1, end: 0 });

/** Reads the marker segment at `i` into `s`. False when `i` does not hold a marker or the segment runs past the end. */
function readSegment(b: Uint8Array, i: number, s: Segment): boolean {
  if (i >= b.length || b[i] !== 0xff) return false;
  s.start = i;
  while (i < b.length && b[i] === 0xff) i++; // fill bytes
  if (i >= b.length) return false;
  s.marker = b[i++];
  if (s.marker === SOI || s.marker === EOI || isStandalone(s.marker)) {
    s.lenAt = -1;
    s.end = i;
    return true;
  }
  if (i + 2 > b.length) return false;
  const len = (b[i] << 8) | b[i + 1];
  if (len < 2 || i + len > b.length) return false;
  s.lenAt = i;
  s.end = i + len;
  return true;
}

/** Copies `b[from, to)` to `out` at `at` byte by byte (no view per segment) and returns the next write index. */
function copy(b: Uint8Array, from: number, to: number, out: Uint8Array, at: number): number {
  for (let k = from; k < to; k++) out[at++] = b[k];
  return at;
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

/**
 * Stored pixel size from the first frame header, read without walking past it. EXIF orientation is not applied.
 * Null when the header is not among the first MAX_SEGMENTS segments.
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  const s = cursor();
  let i = 2;
  for (let count = 1; ; count++) {
    if (count > MAX_SEGMENTS || !readSegment(b, i, s)) return null;
    if (s.marker === SOS || s.marker === EOI || s.marker === SOI) return null;
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

/** True when the payload of the length-bearing segment `s` starts with `id`. */
function hasId(b: Uint8Array, s: Segment, id: readonly number[]): boolean {
  const p = s.lenAt + 2;
  if (s.end - p < id.length) return false;
  for (let k = 0; k < id.length; k++) if (b[p + k] !== id[k]) return false;
  return true;
}

/**
 * Writes a JFIF APP0 with no thumbnail: its identifier, version, units and density, then Xthumbnail = Ythumbnail = 0,
 * length 16. Returns the next write index.
 */
function writeJfif(b: Uint8Array, s: Segment, out: Uint8Array, at: number): number {
  out[at++] = 0xff;
  out[at++] = APP0;
  out[at++] = 0x00;
  out[at++] = JFIF_HEAD + 4;
  at = copy(b, s.lenAt + 2, s.lenAt + 2 + JFIF_HEAD, out, at);
  out[at++] = 0;
  out[at++] = 0;
  return at;
}

/**
 * A copy of the primary image only, walked marker by marker through every scan (pixels are never decoded). An
 * allowlist: keeps SOI, DQT, DHT, DRI, every SOFn, SOS with its scan data and EOI, in order; APP0 only when it is
 * JFIF, rewritten with no thumbnail; APP2 only when it is ICC_PROFILE; APP14 only when it is Adobe. Drops, with
 * their fill bytes, every other APPn (Exif and XMP, JFXX and its thumbnail, MPF, C2PA, IPTC, maker data) and every
 * COM. Stops at the primary image's EOI and drops every byte after it (MPF frames, Motion Photo video). Null on
 * malformed or truncated input, a scan before any frame header, any other marker (DAC, DNL, JPGn, a restart marker
 * outside a scan: neither needed by a baseline or progressive image nor droppable without breaking one), or more
 * than MAX_SEGMENTS marker segments outside the scans. Memory is one buffer the size of the input plus the result;
 * the walk allocates nothing per marker.
 */
export function stripMetadata(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  const out = new Uint8Array(b.length);
  let at = copy(b, 0, 2, out, 0);
  const s = cursor();
  let sawFrame = false;
  let i = 2;
  for (let count = 1; ; count++) {
    if (count > MAX_SEGMENTS || !readSegment(b, i, s) || s.marker === SOI) return null;
    const m = s.marker;
    if (m === EOI) {
      at = copy(b, s.start, s.end, out, at);
      break;
    }
    if (isSof(m)) sawFrame = true;
    if (m === SOS && !sawFrame) return null;
    if (m === DQT || m === DHT || m === DRI || m === SOS || isSof(m)) at = copy(b, s.start, s.end, out, at);
    else if (m === APP0) {
      if (s.end - (s.lenAt + 2) >= JFIF_HEAD + 2 && hasId(b, s, JFIF_ID)) at = writeJfif(b, s, out, at);
    } else if (m === APP2) {
      if (hasId(b, s, ICC_ID)) at = copy(b, s.start, s.end, out, at);
    } else if (m === APP14) {
      if (hasId(b, s, ADOBE_ID)) at = copy(b, s.start, s.end, out, at);
    } else if (!isApp(m) && m !== COM) return null;
    i = s.end;
    if (s.marker === SOS) {
      const end = scanEnd(b, i);
      if (end === null) return null;
      at = copy(b, i, end, out, at);
      i = end;
    }
  }
  return out.slice(0, at);
}
