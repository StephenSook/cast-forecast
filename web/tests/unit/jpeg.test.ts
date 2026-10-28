import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MAX_UPLOAD_BYTES, checkUploadImage, jpegSize, stripMetadata } from "@/server/jpeg";
import { fakeJpeg } from "../helpers/fakeJpeg";

const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(s);

test("jpegSize reads a real baseline file and a progressive SOF2", () => {
  expect(jpegSize(readFileSync("tests/fixtures/plain-640x480.jpg"))).toEqual({ width: 640, height: 480 });
  expect(jpegSize(fakeJpeg(1919, 1079, "SOF2"))).toEqual({ width: 1919, height: 1079 });
});
test("checkUploadImage enforces width < 1920 and height < 1080 (makeup_vto.yaml:1276) and a 480 short side", () => {
  expect(checkUploadImage(fakeJpeg(1919, 1079))).toEqual({ ok: true, width: 1919, height: 1079 });
  expect(checkUploadImage(fakeJpeg(1920, 1079))).toEqual({ ok: false, code: "too_large", status: 413 });
  expect(checkUploadImage(fakeJpeg(1919, 1080))).toEqual({ ok: false, code: "too_large", status: 413 });
  expect(checkUploadImage(fakeJpeg(1919, 479))).toEqual({ ok: false, code: "too_small", status: 422 });
});
test("checkUploadImage refuses a non-JPEG and an oversized body", () => {
  expect(checkUploadImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ code: "unsupported_image", status: 415 });
  expect(checkUploadImage(new Uint8Array(4_000_001))).toMatchObject({ code: "too_large" });
});
test("jpegSize returns null for a truncated file", () => expect(jpegSize(fakeJpeg(800, 600).slice(0, 12))).toBeNull());
test("stripMetadata removes only APP1 and APP13", () => {
  const meta = fakeJpeg(640, 480, "SOF0", { app1: true, app13: true });
  expect(has(meta, "Exif") && has(meta, "Photoshop")).toBe(true);                                // precondition
  expect(checkUploadImage(meta)).toEqual({ ok: true, width: 640, height: 480 });
  expect(stripMetadata(meta)).toEqual(fakeJpeg(640, 480));                                      // only APP1 and APP13 removed
  expect(stripMetadata(fakeJpeg(640, 480))).toEqual(fakeJpeg(640, 480));
  expect(stripMetadata(meta.slice(0, 30))).toBeNull();
});
test("stripMetadata removes real Pillow EXIF with GPS", () => {
  const src = readFileSync("tests/fixtures/exif-rot6-4032x3024.jpg");
  expect(has(src, "Exif")).toBe(true);                                                          // precondition
  const rot = stripMetadata(src)!;                                                              // real Pillow EXIF with GPS
  expect(has(rot, "Exif")).toBe(false); expect(jpegSize(rot)).toEqual({ width: 4032, height: 3024 });
});

// Beyond the brief.
test("the upload cap is 4,000,000 bytes, inclusive", () => {
  expect(MAX_UPLOAD_BYTES).toBe(4_000_000);
  expect(checkUploadImage(new Uint8Array(4_000_000))).toMatchObject({ code: "unsupported_image" });
});
test("checkUploadImage refuses the fixtures that the browser must shrink or cannot decode", () => {
  expect(checkUploadImage(readFileSync("tests/fixtures/tall-1080x4000.jpg"))).toEqual({ ok: false, code: "too_large", status: 413 });
  expect(checkUploadImage(readFileSync("tests/fixtures/not-an-image.heic"))).toEqual({ ok: false, code: "unsupported_image", status: 415 });
  expect(stripMetadata(readFileSync("tests/fixtures/not-an-image.heic"))).toBeNull();
});
test("stripMetadata keeps every other byte in order on a real Pillow file", () => {
  const src = readFileSync("tests/fixtures/exif-rot6-4032x3024.jpg");
  const out = stripMetadata(src)!;
  const app1At = src.indexOf(Buffer.from([0xff, 0xe1]));
  const app1Len = (src[app1At + 2] << 8) | src[app1At + 3];
  expect(Buffer.from(out).equals(Buffer.concat([src.subarray(0, app1At), src.subarray(app1At + 2 + app1Len)]))).toBe(true);
  expect(out).not.toBe(src);                                                                    // a copy, never the input
});
test("jpegSize skips a DHT segment (FF C4) instead of reading it as a frame", () => {
  const plain = fakeJpeg(700, 500);
  const dht = [0xff, 0xc4, 0x00, 0x07, 0x00, 0x01, 0x02, 0x03, 0x04];
  const withDht = new Uint8Array([...plain.slice(0, 20), ...dht, ...plain.slice(20)]);
  expect(jpegSize(withDht)).toEqual({ width: 700, height: 500 });
});
test("jpegSize returns null when the scan starts before any frame header", () =>
  expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toBeNull());

// Fix round 1: the strip walks the whole primary image. Fixtures are built here from labelled segments;
// every payload that must go carries an ASCII sentinel ending in -SECRET.
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0 = seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = seg(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 0, 0, 0, 0]);
const MPF = seg(0xe2, [...ascii("MPF"), 0, ...ascii("MPF-SECRET")]);
const DQT = seg(0xdb, [0, ...Array<number>(64).fill(1)]);
const DHT = seg(0xc4, [0, ...Array<number>(16).fill(0)]);
const DRI = seg(0xdd, [0, 16]);
const sof = (marker: number, w: number, h: number) => seg(marker, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
const SOS = seg(0xda, [1, 1, 0, 0, 63, 0]);
// Entropy-coded data with byte stuffing (FF 00) and a restart marker (FF D0): both belong to the scan.
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78];
const app1 = (tag: string) => seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii(`${tag}-SECRET`)]);
const APP13 = seg(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("IPTC-SECRET")]);
const APP11 = seg(0xeb, [...ascii("JP"), 0, 0, ...ascii("C2PA-SECRET")]);
const COM = seg(0xfe, ascii("COM-SECRET"));
const SECRETS = ["GPS-A-SECRET", "GPS-B-SECRET", "GPS-C-SECRET", "IPTC-SECRET", "C2PA-SECRET", "COM-SECRET", "MPF-SECRET", "MP4-SECRET"];
const u8 = (...parts: number[][]) => new Uint8Array(parts.flat());

// What the decoder needs: a progressive image with two scans, and a baseline one with restart intervals.
const PROGRESSIVE = u8(SOI, APP0, ICC, DQT, sof(0xc2, 800, 600), DHT, SOS, SCAN, DHT, SOS, SCAN, EOI);
const BASELINE = u8(SOI, APP0, DQT, sof(0xc0, 640, 480), DHT, DRI, SOS, SCAN, EOI);
const SECOND_FRAME = u8(SOI, app1("GPS-C"), sof(0xc0, 160, 120), DHT, SOS, SCAN, EOI);
const MP4_TRAILER = u8([0, 0, 0, 0x18], ascii("ftypmp42"), ascii("MP4-SECRET"), [0xff, 0xd9, 0xff, 0xe1]);

test.each([
  ["APP1 between two progressive scans",
    u8(SOI, APP0, ICC, DQT, sof(0xc2, 800, 600), DHT, SOS, SCAN, app1("GPS-A"), DHT, SOS, SCAN, EOI), PROGRESSIVE],
  ["APP1, COM, APP11 and APP13 after the first scan, with fill bytes",
    u8(SOI, APP0, ICC, DQT, sof(0xc2, 800, 600), DHT, SOS, SCAN, [0xff, 0xff], app1("GPS-B"), COM, APP11, APP13, DHT, SOS, SCAN, EOI), PROGRESSIVE],
  ["COM, APP11 and an MPF index in the header",
    u8(SOI, APP0, COM, APP11, MPF, DQT, sof(0xc0, 640, 480), DHT, DRI, SOS, SCAN, EOI), BASELINE],
  ["an MPF-style second frame with its own APP1 after EOI",
    u8([...BASELINE], [...SECOND_FRAME]), BASELINE],
  ["an MP4-like trailer after EOI",
    u8([...PROGRESSIVE], [...MP4_TRAILER]), PROGRESSIVE],
])("stripMetadata drops %s", (_name, input, want) => {
  expect(SECRETS.some((s) => has(input, s))).toBe(true);                                       // precondition
  const out = stripMetadata(input)!;
  expect(out).toEqual(want);
  for (const s of SECRETS) expect(has(out, s), s).toBe(false);
  expect(jpegSize(out)).toEqual(jpegSize(want));
  expect(stripMetadata(out)).toEqual(out);                                                      // the output parses again
});
test.each([
  ["no EOI after the scan", u8(SOI, APP0, DQT, sof(0xc0, 640, 480), DHT, SOS, SCAN)],
  ["a cut inside a segment after the first scan", u8(SOI, sof(0xc2, 800, 600), DHT, SOS, SCAN, DHT.slice(0, 5))],
  ["an FF as the last byte of the scan", u8(SOI, sof(0xc0, 640, 480), DHT, SOS, SCAN, [0xff])],
  ["a scan before any frame header", u8(SOI, APP0, DHT, SOS, SCAN, EOI)],
  ["a second SOI before EOI", u8(SOI, sof(0xc0, 640, 480), SOI, EOI)],
  ["a stray byte where a marker belongs", u8(SOI, APP0, [0x00], sof(0xc0, 640, 480), EOI)],
  ["an APP1 length past the end", u8(SOI, APP0, [0xff, 0xe1, 0x40, 0x00, 0x45])],
])("stripMetadata returns null for %s", (_name, input) => expect(stripMetadata(input)).toBeNull());
// Fix round 2: fill bytes (a run of FF) may precede a restart marker inside a scan. Like libjpeg, a run of FF
// followed by 00 is one stuffed data byte, and followed by RSTn it is a restart marker; both stay in the scan.
test("stripMetadata keeps fill bytes before a restart marker inside a scan", () => {
  const scan = [0x12, 0xff, 0xff, 0xd0, 0x34, 0xff, 0xff, 0xff, 0xd1, 0x56, 0xff, 0xff, 0x00, 0x78];
  const input = u8(SOI, APP0, DQT, sof(0xc0, 640, 480), DHT, DRI, SOS, scan, app1("GPS-A"), EOI);
  const out = stripMetadata(input);
  expect(out).toEqual(u8(SOI, APP0, DQT, sof(0xc0, 640, 480), DHT, DRI, SOS, scan, EOI));
  expect(has(out!, "GPS-A-SECRET")).toBe(false);
});
test.each([
  ["a run of fill bytes at the very end", u8(SOI, sof(0xc0, 640, 480), DHT, SOS, SCAN, [0xff, 0xff, 0xff])],
  ["a restart marker run cut before its marker byte", u8(SOI, sof(0xc0, 640, 480), DHT, SOS, [0x12, 0xff, 0xff])],
])("stripMetadata still returns null for %s", (_name, input) => expect(stripMetadata(input)).toBeNull());
test("jpegSize stops at the first frame header and reads nothing after it", () => {
  const b = fakeJpeg(800, 600);
  expect(jpegSize(b.slice(0, b.length - 2))).toEqual({ width: 800, height: 600 });               // no EOI
  expect(jpegSize(u8([...b.slice(0, b.length - 2)], [0xff, 0xe1, 0xff, 0xff]))).toEqual({ width: 800, height: 600 });
});
